import {
  CONSENT_ACTIONS,
  getConsentDocument,
  getPlayerConsents,
  listConsentDocuments,
  listPlayerConsentHistory,
  publishConsentDocument,
  revokeConsent,
  signConsent,
  type Consent,
  type ConsentDocument,
  type ConsentDocumentSummary,
  type ConsentTypeStatus,
} from '@sport-performance/contracts';
import { consent, consentDocument } from '@sport-performance/db/schema';
import {
  CONSENT_TYPES,
  consentSignerOfRole,
  consentStates,
  guardianConsentsLapseOn,
  guardianConsentsLapsed,
  permittedActions,
  requiredConsentSigner,
  type ClubId,
  type ConsentSigner,
  type ConsentType,
  type CurrentConsentDocument,
  type PermissionSubject,
  type PlayerId,
  type UserId,
} from '@sport-performance/domain';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { requirePlayerFacts, type LoadedPlayer } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { insertIdempotent, markReplay } from '../http/writes.js';

/**
 * Consents (B-312, ADR 0043): versioned texts of the club, signature and
 * revocation by the holder (the guardian of a minor, the player once of
 * age), and the status and history of each player's consents.
 */

// ─── Texts ──────────────────────────────────────────────────────────────────

/**
 * The text is the last published of its type (ties by id, so exactly one is current).
 * Written out: the outer query reads `consent_document` without an alias.
 */
const isCurrentDocument: SQL<boolean> = sql<boolean>`not exists (
  select 1 from "public"."consent_document" newer
   where newer.club_id = "consent_document"."club_id" and newer.type = "consent_document"."type"
     and (newer.published_at, newer.id) > ("consent_document"."published_at", "consent_document"."id"))`;

const documentSummaryColumns = {
  id: consentDocument.id,
  type: consentDocument.type,
  version: consentDocument.version,
  locale: consentDocument.locale,
  title: consentDocument.title,
  bodySha256: consentDocument.bodySha256,
  publishedAt: consentDocument.publishedAt,
  current: isCurrentDocument,
};

interface DocumentSummaryRow {
  id: string;
  type: ConsentType;
  version: string;
  locale: string;
  title: string;
  bodySha256: string;
  publishedAt: Date;
  current: boolean;
}

interface DocumentRow extends DocumentSummaryRow {
  body: string;
}

function documentSummaryDto(row: DocumentSummaryRow): ConsentDocumentSummary {
  return {
    id: row.id as ConsentDocumentSummary['id'],
    type: row.type,
    version: row.version,
    locale: row.locale as ConsentDocumentSummary['locale'],
    title: row.title,
    bodySha256: row.bodySha256,
    publishedAt: row.publishedAt.toISOString(),
    current: row.current,
  };
}

function documentDto(row: DocumentRow): ConsentDocument {
  return { ...documentSummaryDto(row), body: row.body };
}

const DOCUMENT_KEYS: KeysetSpec<DocumentSummaryRow, 'publishedAt'> = {
  fields: {
    publishedAt: {
      column: consentDocument.publishedAt,
      type: 'timestamp',
      value: (row) => row.publishedAt,
    },
  },
  id: { column: consentDocument.id, value: (row) => row.id },
};

async function readDocument(
  db: TenantDatabase,
  clubId: ClubId,
  documentId: string,
): Promise<DocumentRow | undefined> {
  const [row] = await db
    .select({ ...documentSummaryColumns, body: consentDocument.body })
    .from(consentDocument)
    .where(and(eq(consentDocument.clubId, clubId), eq(consentDocument.id, documentId)));
  return row;
}

/** The current text of each type the club published. */
async function currentDocuments(
  db: TenantDatabase,
  clubId: ClubId,
): Promise<Map<ConsentType, DocumentSummaryRow>> {
  const rows = await db
    .select(documentSummaryColumns)
    .from(consentDocument)
    .where(and(eq(consentDocument.clubId, clubId), isCurrentDocument));
  return new Map(rows.map((row) => [row.type, row]));
}

// ─── Signed consents ────────────────────────────────────────────────────────

const consentColumns = {
  id: consent.id,
  playerId: consent.playerId,
  type: consent.type,
  documentId: consent.documentId,
  documentVersion: consent.documentVersion,
  signerKind: consent.signerKind,
  signedBy: consent.signedBy,
  signedAt: consent.signedAt,
  revokedAt: consent.revokedAt,
  revokedBy: consent.revokedBy,
};

interface ConsentRow {
  id: string;
  playerId: PlayerId;
  type: ConsentType;
  documentId: string | null;
  documentVersion: string;
  signerKind: ConsentSigner;
  signedBy: string;
  signedAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
}

function consentDto(row: ConsentRow): Consent {
  return {
    id: row.id as Consent['id'],
    playerId: row.playerId,
    type: row.type,
    documentId: row.documentId as Consent['documentId'],
    documentVersion: row.documentVersion,
    signerKind: row.signerKind,
    signedBy: row.signedBy as UserId,
    signedAt: row.signedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy as UserId | null,
  };
}

const CONSENT_KEYS: KeysetSpec<ConsentRow, 'signedAt'> = {
  fields: {
    signedAt: { column: consent.signedAt, type: 'timestamp', value: (row) => row.signedAt },
  },
  id: { column: consent.id, value: (row) => row.id },
};

const ofPlayer = (clubId: ClubId, playerId: PlayerId) =>
  and(eq(consent.clubId, clubId), eq(consent.playerId, playerId));

/** The status of each consent type of a player, for the caller. */
async function typeStatuses(
  db: TenantDatabase,
  clubId: ClubId,
  subject: PermissionSubject,
  { facts, birthDate, today }: LoadedPlayer,
  types: readonly ConsentType[] = CONSENT_TYPES,
): Promise<ConsentTypeStatus[]> {
  const consents = await db.select(consentColumns).from(consent).where(ofPlayer(clubId, facts.id));
  const documents = await currentDocuments(db, clubId);
  // The transaction's clock, the one `app.current_consent_types` and the revocation use.
  const { rows } = await db.execute<{ now: Date }>(sql`select now() as now`);
  const now = new Date(rows[0]?.now ?? Date.now());
  const current: Partial<Record<ConsentType, CurrentConsentDocument>> = {};
  for (const [type, document] of documents) current[type] = document;
  const actions = permittedActions(subject, {
    kind: 'consent',
    clubId,
    player: facts,
  }).filter((action) =>
    (CONSENT_ACTIONS as readonly string[]).includes(action),
  ) as (typeof CONSENT_ACTIONS)[number][];
  // The majority (B-311) on the club's day, as `app.current_consent_types` computes it.
  const holder = {
    ofAge: facts.ofAge ?? false,
    guardianConsentsLapsed: guardianConsentsLapsed(birthDate, today),
  };
  return consentStates(consents, current, now, holder)
    .filter((state) => types.includes(state.type))
    .map((state) => {
      const document = documents.get(state.type);
      return {
        type: state.type,
        state: state.state,
        consent: state.current === null ? null : consentDto(state.current),
        currentDocument: document === undefined ? null : documentSummaryDto(document),
        actions,
      };
    });
}

export function registerConsentRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listConsentDocuments, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      // The texts are read by everyone who signs them or shows them: every member.
      await permissions.authorize('club', 'read');
      const plan = keysetPage(DOCUMENT_KEYS, query, { type: query.type, status: query.status });
      const rows = await db
        .select(documentSummaryColumns)
        .from(consentDocument)
        .where(
          and(
            eq(consentDocument.clubId, caller.membership.clubId),
            query.type === undefined ? undefined : eq(consentDocument.type, query.type),
            query.status === 'current' ? isCurrentDocument : undefined,
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, documentSummaryDto);
    },
  });

  registerEndpoint(app, getConsentDocument, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'read');
      const row = await readDocument(db, caller.membership.clubId, params.documentId);
      if (row === undefined) throw new HttpError('not_found', 'Consent text not found');
      return documentDto(row);
    },
  });

  registerEndpoint(app, publishConsentDocument, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      // The club's legal texts are club settings, like its brand: the administration.
      await permissions.authorize('club', 'update');
      const { clubId } = caller.membership;
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(consentDocument)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                type: body.type,
                version: body.version,
                locale: body.locale,
                title: body.title,
                body: body.body,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [consentDocument.clubId, consentDocument.clientUuid] })
              .returning({ id: consentDocument.id })
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select({ id: consentDocument.id })
              .from(consentDocument)
              .where(
                and(eq(consentDocument.clubId, clubId), eq(consentDocument.clientUuid, clientUuid)),
              )
          )[0],
      });
      // Read back: the hash comes from the database, and whether it is current is a query.
      const document = await readDocument(db, clubId, row.id);
      if (document === undefined) throw new Error('publishConsentDocument: the text vanished');
      return documentDto(document);
    },
  });

  registerEndpoint(app, getPlayerConsents, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const loaded = await requirePlayerFacts(db, clubId, params.playerId);
      const { facts } = loaded;
      await permissions.authorize('consent', 'read', { player: facts });
      const ofAge = facts.ofAge ?? false;
      return {
        playerId: facts.id,
        playerOfAge: ofAge,
        requiredSigner: requiredConsentSigner(ofAge),
        guardianSignaturesLapseOn: guardianConsentsLapseOn(loaded.birthDate),
        types: await typeStatuses(db, clubId, await permissions.subject(), loaded),
      };
    },
  });

  registerEndpoint(app, listPlayerConsentHistory, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { facts } = await requirePlayerFacts(db, clubId, params.playerId);
      await permissions.authorize('consent', 'read', { player: facts });
      const plan = keysetPage(CONSENT_KEYS, query, { playerId: facts.id, type: query.type });
      const rows = await db
        .select(consentColumns)
        .from(consent)
        .where(
          and(
            ofPlayer(clubId, facts.id),
            query.type === undefined ? undefined : eq(consent.type, query.type),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, consentDto);
    },
  });

  registerEndpoint(app, signConsent, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const { facts } = await requirePlayerFacts(db, clubId, params.playerId);
      await permissions.authorize('consent', 'sign', { player: facts });
      const signerKind = consentSignerOfRole(caller.membership.role);
      if (signerKind === null) {
        // The matrix only lets the parent and player roles sign.
        throw new Error(`signConsent: the matrix let ${caller.membership.role} sign`);
      }
      const byClientUuid = async (clientUuid: string) =>
        (
          await db
            .select(consentColumns)
            .from(consent)
            .where(and(eq(consent.clubId, clubId), eq(consent.clientUuid, clientUuid)))
        )[0];
      // A retry of a signature that went through answers the same, even if the text was
      // superseded since.
      if (body.clientUuid !== undefined) {
        const previous = await byClientUuid(body.clientUuid);
        if (previous !== undefined) {
          if (previous.playerId !== facts.id) {
            throw new HttpError('conflict', 'This clientUuid was already used');
          }
          markReplay(reply);
          return consentDto(previous);
        }
      }

      const document = await readDocument(db, clubId, body.documentId);
      if (document === undefined) throw new HttpError('not_found', 'Consent text not found');
      if (!document.current) {
        throw new HttpError(
          'conflict',
          'This is not the current version of the consent text: sign the current one',
        );
      }
      // Once per text and signer: the adult signs the text their guardian signed (B-311).
      const [already] = await db
        .select({ id: consent.id })
        .from(consent)
        .where(
          and(
            ofPlayer(clubId, facts.id),
            eq(consent.documentId, document.id),
            eq(consent.signerKind, signerKind),
            isNull(consent.revokedAt),
          ),
        );
      if (already !== undefined) {
        throw new HttpError('conflict', 'This consent text is already signed and current');
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(consent)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                playerId: facts.id,
                type: document.type,
                documentVersion: document.version,
                documentId: document.id,
                signerKind,
                signedBy: caller.userId,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [consent.clubId, consent.clientUuid] })
              .returning(consentColumns)
          )[0],
        findByClientUuid: byClientUuid,
      });
      return consentDto(row);
    },
  });

  registerEndpoint(app, revokeConsent, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const loaded = await requirePlayerFacts(db, clubId, params.playerId);
      const { facts } = loaded;
      await permissions.authorize('consent', 'revoke', { player: facts });
      await db
        .update(consent)
        .set({ revokedAt: sql`now()`, revokedBy: caller.userId, updatedBy: caller.userId })
        .where(
          and(ofPlayer(clubId, facts.id), eq(consent.type, params.type), isNull(consent.revokedAt)),
        );
      const consents = facts.consents?.filter((type) => type !== params.type) ?? [];
      const [status] = await typeStatuses(
        db,
        clubId,
        await permissions.subject(),
        { ...loaded, facts: { ...facts, consents } },
        [params.type],
      );
      if (status === undefined) throw new Error('revokeConsent: no status for the type');
      return status;
    },
  });
}
