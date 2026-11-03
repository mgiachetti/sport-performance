import { ApiError, createClub } from '@sport-performance/contracts';
import {
  DEFAULT_CLUB_TIME_ZONE,
  SEXES,
  SPORTS,
  type Sex,
  type Sport,
} from '@sport-performance/domain';
import { SUPPORTED_LOCALES, type Locale, type MessageKey } from '@sport-performance/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { translate, useT } from '../i18n/i18n';
import { CheckboxField } from '../ui/choice';
import { Button, ErrorNotice, Notice, Page, TextField } from '../ui/components';
import { FieldGroup, SelectField } from '../ui/fields';
import { registryHeaders } from './console-reason';
import { useConsole } from './ConsoleLayout';
import { consoleKeys } from './queries';

/** Default brand of the product (ORC), the API's default when no colors are sent. */
const DEFAULT_COLORS = { primary: '#f1882a', secondary: '#050505' };

/** A URL-safe slug from a club's name: `Club Atlético San Isidro` → `club-atletico-san-isidro`. */
export function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

type Field = 'name' | 'shortName' | 'slug' | 'timeZone' | 'locale' | 'colors' | 'branches';
type FieldErrors = Partial<Record<Field, MessageKey>>;

const branchKey = (sport: Sport, sex: Sex) => `${sport}:${sex}`;
const BRANCHES = SPORTS.flatMap((sport) => SEXES.map((sex) => ({ sport, sex })));

function errorKeyOf(field: Field): MessageKey {
  switch (field) {
    case 'slug':
      return 'console.newClub.error.slug';
    case 'timeZone':
      return 'console.newClub.error.timeZone';
    case 'branches':
      return 'console.newClub.error.branches';
    default:
      return 'console.newClub.error.invalid';
  }
}

/**
 * Onboarding of a club (B-414): the registry's `POST /v1/clubs`, which seeds
 * the default configuration of each branch in the same transaction. The
 * form validates with the contract's own schema before sending, and keeps
 * one `clientUuid` so a retry never creates the club twice (ADR 0032).
 */
export function NewClubPage() {
  const t = useT();
  const { api, reason } = useConsole();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [timeZone, setTimeZone] = useState<string>(DEFAULT_CLUB_TIME_ZONE);
  const [locale, setLocale] = useState<Locale>('es-AR');
  const [customColors, setCustomColors] = useState(false);
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [branches, setBranches] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<FieldErrors>({});

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createClub>[0]['body']) =>
      api.createClub({ body }, { headers: registryHeaders(reason) }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: [...consoleKeys.all, 'clubs'] });
      await navigate({ to: '/console/clubs/$clubId', params: { clubId: created.club.id } });
    },
    onError: (error) => {
      // The slug is the only unique field of a club.
      if (error instanceof ApiError && error.code === 'conflict') {
        setErrors({ slug: 'console.newClub.error.slugTaken' });
      }
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = {
      clientUuid,
      slug,
      name: name.trim(),
      shortName: shortName.trim(),
      timeZone: timeZone.trim(),
      locale,
      ...(customColors ? { colors } : {}),
      branches: BRANCHES.filter((b) => branches.has(branchKey(b.sport, b.sex))),
    };
    const parsed = createClub.body.safeParse(body);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field | undefined;
        if (field !== undefined && next[field] === undefined) next[field] = errorKeyOf(field);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(body);
  };

  const errorOf = (field: Field) => {
    const key = errors[field];
    return key === undefined ? null : translate(t, key);
  };

  const toggleBranch = (key: string, on: boolean) => {
    const next = new Set(branches);
    if (on) next.add(key);
    else next.delete(key);
    setBranches(next);
  };

  return (
    <Page title={t('console.newClub.title')} subtitle={t('console.newClub.subtitle')}>
      <form className="sp-form sp-form--narrow" onSubmit={submit} noValidate>
        {Object.keys(errors).length > 0 ? (
          <Notice level="warning" role="alert">
            <p>{t('console.newClub.error.summary')}</p>
          </Notice>
        ) : null}
        <TextField
          label={t('console.newClub.name')}
          name="name"
          required
          maxLength={120}
          value={name}
          error={errorOf('name')}
          onChange={(event) => {
            setName(event.target.value);
            if (!slugEdited) setSlug(slugFromName(event.target.value));
          }}
        />
        <TextField
          label={t('console.newClub.shortName')}
          help={t('console.newClub.shortName.help')}
          name="shortName"
          required
          maxLength={16}
          value={shortName}
          error={errorOf('shortName')}
          onChange={(event) => {
            setShortName(event.target.value);
          }}
        />
        <TextField
          label={t('console.newClub.slug')}
          help={t('console.newClub.slug.help')}
          name="slug"
          required
          maxLength={63}
          autoCapitalize="none"
          spellCheck={false}
          value={slug}
          error={errorOf('slug')}
          onChange={(event) => {
            setSlug(event.target.value);
            setSlugEdited(true);
          }}
        />
        <TextField
          label={t('console.newClub.timeZone')}
          help={t('console.newClub.timeZone.help')}
          name="timeZone"
          required
          maxLength={64}
          spellCheck={false}
          value={timeZone}
          error={errorOf('timeZone')}
          onChange={(event) => {
            setTimeZone(event.target.value);
          }}
        />
        <SelectField
          label={t('console.newClub.locale')}
          name="locale"
          value={locale}
          error={errorOf('locale')}
          onChange={(event) => {
            setLocale(event.target.value as Locale);
          }}
          options={SUPPORTED_LOCALES.map((option) => ({
            value: option,
            label: translate(t, `console.locale.${option.replace('-', '_')}` as MessageKey),
          }))}
        />
        <CheckboxField
          label={t('console.newClub.colors.custom')}
          checked={customColors}
          onChange={(event) => {
            setCustomColors(event.target.checked);
          }}
        />
        {customColors ? (
          <div className="sp-form__row">
            <TextField
              label={t('console.newClub.colors.primary')}
              type="color"
              name="primaryColor"
              value={colors.primary}
              error={errorOf('colors')}
              onChange={(event) => {
                setColors({ ...colors, primary: event.target.value });
              }}
            />
            <TextField
              label={t('console.newClub.colors.secondary')}
              type="color"
              name="secondaryColor"
              value={colors.secondary}
              onChange={(event) => {
                setColors({ ...colors, secondary: event.target.value });
              }}
            />
          </div>
        ) : null}
        <FieldGroup
          legend={t('console.newClub.branches')}
          help={t('console.newClub.branches.help')}
          error={errorOf('branches')}
        >
          {BRANCHES.map(({ sport, sex }) => {
            const key = branchKey(sport, sex);
            return (
              <CheckboxField
                key={key}
                label={t('console.branch.name', {
                  sport: t(`sport.${sport}`),
                  sex: t(`sex.${sex}`),
                })}
                checked={branches.has(key)}
                onChange={(event) => {
                  toggleBranch(key, event.target.checked);
                }}
              />
            );
          })}
        </FieldGroup>
        {create.isError &&
        !(create.error instanceof ApiError && create.error.code === 'conflict') ? (
          <ErrorNotice error={create.error} />
        ) : null}
        <Button type="submit" disabled={create.isPending}>
          {t('console.newClub.submit')}
        </Button>
      </form>
    </Page>
  );
}
