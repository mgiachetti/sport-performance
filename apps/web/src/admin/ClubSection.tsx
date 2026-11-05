import {
  CLUB_NAME_MAX_LENGTH,
  CLUB_SHORT_NAME_MAX_LENGTH,
  type Club,
} from '@sport-performance/contracts';
import { FILE_KIND_POLICIES } from '@sport-performance/domain';
import {
  CONTRAST,
  contrastRatio,
  isHexColor,
  lightHighContrastPalette,
  mostContrasting,
  normalizeHex,
  orcPalette,
} from '@sport-performance/ui-tokens';
import { useMutation } from '@tanstack/react-query';
import { useState, type ChangeEvent, type SubmitEvent } from 'react';
import { clubProfileQuery, clubThemeQuery } from '../api/queries';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, Notice, TextField } from '../ui/components';
import { SelectField } from '../ui/fields';
import { ActionError, AdminSection, ConfirmAction, isConflict } from './parts';
import { UploadFailedError, uploadClubLogo } from './upload';

export interface ClubDraft {
  readonly name: string;
  readonly shortName: string;
  readonly timeZone: string;
  readonly primary: string;
  readonly secondary: string;
}

export type ClubDraftError = 'name' | 'shortName' | 'primary' | 'secondary';

export function clubDraftOf(club: Club): ClubDraft {
  return {
    name: club.name,
    shortName: club.shortName,
    timeZone: club.timeZone,
    primary: club.colors.primary,
    secondary: club.colors.secondary,
  };
}

export function clubDraftErrors(draft: ClubDraft): ClubDraftError[] {
  const errors: ClubDraftError[] = [];
  const name = draft.name.trim();
  if (name === '' || name.length > CLUB_NAME_MAX_LENGTH) errors.push('name');
  const shortName = draft.shortName.trim();
  if (shortName === '' || shortName.length > CLUB_SHORT_NAME_MAX_LENGTH) errors.push('shortName');
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.primary)) errors.push('primary');
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.secondary)) errors.push('secondary');
  return errors;
}

/** The `PATCH /v1/club` body: only what changed, with the version read (ADR 0032). */
export function clubPatch(club: Club, draft: ClubDraft) {
  const name = draft.name.trim();
  const shortName = draft.shortName.trim();
  const primary = draft.primary.toLowerCase();
  const secondary = draft.secondary.toLowerCase();
  const colors = {
    ...(primary === club.colors.primary ? {} : { primary }),
    ...(secondary === club.colors.secondary ? {} : { secondary }),
  };
  return {
    version: club.version,
    ...(name === club.name ? {} : { name }),
    ...(shortName === club.shortName ? {} : { shortName }),
    ...(draft.timeZone === club.timeZone ? {} : { timeZone: draft.timeZone }),
    ...(Object.keys(colors).length === 0 ? {} : { colors }),
  };
}

function timeZones(current: string): string[] {
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return all.includes(current) ? all : [current, ...all];
}

/**
 * Profile and brand of the club (B-411 over B-313 and B-325): name, short
 * name, time zone ("el día" of every screen), the two jersey colors and the
 * crest. The web and the app apply them at runtime (white-label, ADR 0014).
 */
export function ClubSection() {
  const t = useT();
  const { club } = useActiveClub();
  // Outcomes outlive the form, which starts again on each new version.
  const [saved, setSaved] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  return (
    <div className="sp-admin__club-grid">
      <AdminSection id="admin-club" title={t('admin.club.title')} intro={t('admin.club.intro')}>
        {/* A new version (after a save or a conflict) starts the form again from it. */}
        <ClubForm
          key={club.version}
          club={club}
          onSaved={(version) => {
            setConflict(false);
            setSaved(version);
          }}
          onConflict={() => {
            setSaved(null);
            setConflict(true);
          }}
        />
        {conflict ? (
          <Notice level="warning" role="alert">
            <p>{t('admin.conflict')}</p>
          </Notice>
        ) : null}
        {saved === club.version ? (
          <Notice level="ok" role="status">
            <p>{t('admin.club.saved')}</p>
          </Notice>
        ) : null}
      </AdminSection>
      <AdminSection
        id="admin-logo"
        title={t('admin.logo.title')}
        intro={t('admin.logo.intro', {
          maxMiB: FILE_KIND_POLICIES.club_logo.maxSizeBytes / (1024 * 1024),
        })}
      >
        <LogoForm club={club} />
      </AdminSection>
    </div>
  );
}

function useRefreshClub() {
  const { api, queryClient } = useServices();
  const { selection, club } = useActiveClub();
  return async (updated?: Club) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: clubProfileQuery(api, selection).queryKey }),
      queryClient.invalidateQueries({ queryKey: clubThemeQuery(api, club.slug).queryKey }),
      updated === undefined || updated.slug === club.slug
        ? null
        : queryClient.invalidateQueries({ queryKey: clubThemeQuery(api, updated.slug).queryKey }),
    ]);
  };
}

function ClubForm(props: {
  club: Club;
  onSaved: (version: string) => void;
  onConflict: () => void;
}) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshClub();
  const [draft, setDraft] = useState<ClubDraft>(() => clubDraftOf(props.club));
  const [submitted, setSubmitted] = useState(false);
  const errors = clubDraftErrors(draft);
  const has = (error: ClubDraftError) => submitted && errors.includes(error);
  const patch = clubPatch(props.club, draft);
  const changed = Object.keys(patch).length > 1;

  const save = useMutation({
    mutationFn: () => api.updateClub({ body: patch }),
    onSuccess: async (updated) => {
      props.onSaved(updated.version);
      await refresh(updated);
    },
    onError: async (error) => {
      if (isConflict(error)) props.onConflict();
      await refresh();
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.length > 0 || !changed) return;
    save.mutate();
  };

  const set =
    (field: keyof ClubDraft) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.target.value;
      setDraft((current) => ({ ...current, [field]: value }));
    };

  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      <div className="sp-form__row">
        <TextField
          label={t('admin.club.name')}
          maxLength={CLUB_NAME_MAX_LENGTH}
          value={draft.name}
          error={has('name') ? t('error.validation.required') : null}
          onChange={set('name')}
        />
        <TextField
          label={t('admin.club.shortName')}
          help={t('admin.club.shortNameHelp', { max: CLUB_SHORT_NAME_MAX_LENGTH })}
          maxLength={CLUB_SHORT_NAME_MAX_LENGTH}
          value={draft.shortName}
          error={has('shortName') ? t('error.validation.required') : null}
          onChange={set('shortName')}
        />
        <SelectField
          label={t('admin.club.timeZone')}
          help={t('admin.club.timeZoneHelp')}
          value={draft.timeZone}
          options={timeZones(props.club.timeZone).map((zone) => ({ value: zone, label: zone }))}
          onChange={set('timeZone')}
        />
      </div>
      <fieldset className="sp-fieldset">
        <legend className="sp-field__label">{t('admin.club.colors')}</legend>
        <div className="sp-form__row">
          <ColorField
            label={t('admin.club.primary')}
            value={draft.primary}
            error={has('primary')}
            onChange={(primary) => {
              setDraft((current) => ({ ...current, primary }));
            }}
          />
          <ColorField
            label={t('admin.club.secondary')}
            value={draft.secondary}
            error={has('secondary')}
            onChange={(secondary) => {
              setDraft((current) => ({ ...current, secondary }));
            }}
          />
        </div>
        <BrandPreview primary={draft.primary} secondary={draft.secondary} name={draft.shortName} />
      </fieldset>
      {isConflict(save.error) ? null : <ActionError error={save.error} />}
      <div className="sp-form__actions">
        <Button type="submit" disabled={save.isPending || !changed}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function ColorField(props: {
  label: string;
  value: string;
  error: boolean;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const valid = isHexColor(props.value) && props.value.length === 7;
  return (
    <div className="sp-admin__color">
      <TextField
        label={props.label}
        help={t('admin.club.colorHelp')}
        value={props.value}
        maxLength={7}
        spellCheck={false}
        error={props.error ? t('admin.club.colorInvalid') : null}
        onChange={(event) => {
          props.onChange(event.target.value.trim());
        }}
      />
      <input
        type="color"
        className="sp-admin__color-picker"
        aria-label={t('admin.club.pick', { label: props.label })}
        value={valid ? normalizeHex(props.value) : '#000000'}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
      />
    </div>
  );
}

/** How the brand will look, and whether the theme will have to adjust a color to keep it legible. */
function BrandPreview(props: { primary: string; secondary: string; name: string }) {
  const t = useT();
  if (!/^#[0-9a-fA-F]{6}$/.test(props.primary) || !/^#[0-9a-fA-F]{6}$/.test(props.secondary)) {
    return null;
  }
  const lowOnDark = contrastRatio(props.primary, orcPalette.background) < CONTRAST.nonText;
  const lowOnLight =
    contrastRatio(props.primary, lightHighContrastPalette.background) < CONTRAST.nonText;
  return (
    <div className="sp-admin__preview">
      <div
        className="sp-admin__preview-stripes"
        aria-hidden="true"
        style={{
          backgroundImage: `repeating-linear-gradient(180deg, ${props.primary} 0 10px, ${props.secondary} 10px 20px)`,
        }}
      />
      <span
        className="sp-admin__preview-chip"
        style={{
          background: props.primary,
          color: mostContrasting(props.primary, ['#050505', '#ffffff']),
        }}
      >
        {props.name.trim() === '' ? t('admin.club.previewName') : props.name}
      </span>
      {lowOnDark || lowOnLight ? (
        <Notice level="warning">
          <p>{lowOnDark ? t('admin.club.lowContrastDark') : t('admin.club.lowContrastLight')}</p>
        </Notice>
      ) : null}
    </div>
  );
}

function LogoForm(props: { club: Club }) {
  const t = useT();
  const { api } = useServices();
  const { theme } = useActiveClub();
  const refresh = useRefreshClub();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const policy = FILE_KIND_POLICIES.club_logo;

  const upload = useMutation({
    mutationFn: async (picked: File) => {
      const uploaded = await uploadClubLogo(api, picked);
      return api.updateClub({ body: { version: props.club.version, logoFileId: uploaded.id } });
    },
    onSettled: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: () => api.updateClub({ body: { version: props.club.version, logoFileId: null } }),
    onSettled: () => refresh(),
  });

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null;
    upload.reset();
    setFile(null);
    setFileError(null);
    if (picked === null) return;
    if (!(policy.contentTypes as readonly string[]).includes(picked.type)) {
      setFileError(t('admin.logo.type'));
      return;
    }
    if (picked.size > policy.maxSizeBytes) {
      setFileError(t('admin.logo.size', { maxMiB: policy.maxSizeBytes / (1024 * 1024) }));
      return;
    }
    setFile(picked);
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (file !== null) upload.mutate(file);
  };

  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      <div className="sp-admin__logo">
        {theme.logoUrl === null ? (
          <p className="sp-admin__meta">{t('admin.logo.none')}</p>
        ) : (
          <img src={theme.logoUrl} alt={t('admin.logo.current', { clubName: props.club.name })} />
        )}
      </div>
      <TextField
        label={t('admin.logo.file')}
        help={t('admin.logo.help')}
        type="file"
        accept={policy.contentTypes.join(',')}
        error={fileError}
        onChange={pick}
      />
      {upload.error instanceof UploadFailedError ? (
        <Notice level="critical" role="alert">
          <p>{t('admin.logo.uploadFailed')}</p>
        </Notice>
      ) : (
        <ActionError error={upload.error ?? remove.error} />
      )}
      {upload.isSuccess ? (
        <Notice level="ok" role="status">
          <p>{t('admin.logo.uploaded')}</p>
        </Notice>
      ) : null}
      <div className="sp-form__actions">
        <Button type="submit" disabled={file === null || upload.isPending}>
          {upload.isPending ? t('admin.logo.uploading') : t('admin.logo.upload')}
        </Button>
        {props.club.logoFileId === null ? null : (
          <ConfirmAction
            label={t('admin.logo.remove')}
            question={t('admin.logo.removeQuestion')}
            pending={remove.isPending}
            onConfirm={() => {
              remove.mutate();
            }}
          />
        )}
      </div>
    </form>
  );
}
