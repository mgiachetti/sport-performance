import type { ProtocolMediaDto, TestDefinitionDto } from '@sport-performance/contracts';
import { FILE_KIND_POLICIES, PROTOCOL_MEDIA_CAPTION_MAX_LENGTH } from '@sport-performance/domain';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useId, useRef, useState, type SubmitEvent } from 'react';
import { sha256Base64 } from '../../api/storage-upload';
import { useServices } from '../../app/services';
import { useActiveClub } from '../../club/active-club';
import { useT } from '../../i18n/i18n';
import { useCan } from '../../permissions/permissions';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../../ui/components';
import { Icon } from '../../ui/icons';
import { fileDownloadQuery, protocolMediaKey, protocolMediaQuery } from './queries';

const POLICY = FILE_KIND_POLICIES.protocol_media;
const MAX_MB = Math.floor(POLICY.maxSizeBytes / (1024 * 1024));
const ACCEPTED: readonly string[] = POLICY.contentTypes;

/**
 * Images and videos of a protocol version (B-415, ADR 0067): the staff
 * watches them; `sc` and the administration add, describe and remove them.
 * The bytes go straight to the bucket with a signed `PUT` (ADR 0044).
 */
export function ProtocolMediaSection({ definition }: { definition: TestDefinitionDto }) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const canEdit = useCan('configuration', 'update');
  const media = useQuery(protocolMediaQuery(api, selection, definition.id));

  return (
    <section className="sp-card" aria-labelledby="protocol-media">
      <h2 id="protocol-media" className="sp-card__title">
        {t('help.media.title')}
      </h2>
      <p className="sp-field__help">{t('help.media.staffOnly')}</p>
      {media.isPending ? <Loading /> : null}
      {media.isError ? <ErrorNotice error={media.error} /> : null}
      {media.data?.length === 0 ? <p>{t('help.media.empty')}</p> : null}
      {media.data === undefined || media.data.length === 0 ? null : (
        <ul className="sp-media-list">
          {media.data.map((item) => (
            <li key={item.id} className="sp-media-list__item">
              <MediaItem item={item} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
      {canEdit ? <AddMediaForm testDefinitionId={definition.id} /> : null}
    </section>
  );
}

function MediaViewer({ item }: { item: ProtocolMediaDto }) {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const download = useQuery(fileDownloadQuery(api, selection, item.file.id));
  // A signed URL expires in minutes: ask for a new one once if the browser cannot load it.
  const retried = useRef(false);
  const onError = () => {
    if (retried.current) return;
    retried.current = true;
    void download.refetch();
  };
  if (download.isPending) return <Loading />;
  if (download.isError) {
    return (
      <Notice level="warning">
        <p>{t('help.media.loadFailed')}</p>
      </Notice>
    );
  }
  const isVideo = item.file.contentType.startsWith('video/');
  return isVideo ? (
    <video
      className="sp-media"
      controls
      preload="metadata"
      src={download.data.url}
      aria-label={t('help.media.video', { caption: item.caption })}
      onError={onError}
    />
  ) : (
    <img className="sp-media" src={download.data.url} alt={item.caption} onError={onError} />
  );
}

function MediaItem({ item, canEdit }: { item: ProtocolMediaDto; canEdit: boolean }) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(item.caption);
  const [message, setMessage] = useState<string | null>(null);
  const key = protocolMediaKey(selection, item.testDefinitionId);

  const save = useMutation({
    mutationFn: (next: string) =>
      api.updateProtocolMedia({
        params: { testDefinitionId: item.testDefinitionId, mediaId: item.id },
        body: { version: item.version, caption: next },
      }),
    onSuccess: async () => {
      setEditing(false);
      setMessage(t('help.media.saved'));
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      api.archiveProtocolMedia({
        params: { testDefinitionId: item.testDefinitionId, mediaId: item.id },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const onSave = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = caption.trim();
    if (next === '') return;
    save.mutate(next);
  };

  return (
    <figure className="sp-media-figure">
      <MediaViewer item={item} />
      <figcaption>{item.caption}</figcaption>
      {message === null ? null : (
        <Notice level="ok" role="status">
          <p>{message}</p>
        </Notice>
      )}
      {canEdit && editing ? (
        <form className="sp-form" onSubmit={onSave} noValidate>
          <TextField
            label={t('help.media.add.caption')}
            name="caption"
            required
            maxLength={PROTOCOL_MEDIA_CAPTION_MAX_LENGTH}
            value={caption}
            onChange={(event) => {
              setCaption(event.target.value);
            }}
          />
          {save.isError ? <ErrorNotice error={save.error} /> : null}
          <div className="sp-form__actions">
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setCaption(item.caption);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : null}
      {canEdit && !editing ? (
        <div className="sp-form__actions">
          <Button
            variant="secondary"
            aria-label={t('help.media.edit', { caption: item.caption })}
            onClick={() => {
              setMessage(null);
              setEditing(true);
            }}
          >
            {t('common.edit')}
          </Button>
          <Button
            variant="ghost"
            aria-label={t('help.media.archiveLabel', { caption: item.caption })}
            disabled={archive.isPending}
            onClick={() => {
              archive.mutate();
            }}
          >
            {t('help.media.archive')}
          </Button>
        </div>
      ) : null}
      {archive.isError ? <ErrorNotice error={archive.error} /> : null}
    </figure>
  );
}

interface AddMediaInput {
  readonly file: File;
  readonly caption: string;
  readonly uploadUuid: string;
  readonly attachUuid: string;
}

function AddMediaForm({ testDefinitionId }: { testDefinitionId: string }) {
  const t = useT();
  const { api, queryClient, uploadToStorage } = useServices();
  const { selection } = useActiveClub();
  const fileInputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async (input: AddMediaInput) => {
      const created = await api.createFileUpload({
        body: {
          kind: 'protocol_media',
          clientUuid: input.uploadUuid,
          contentType: input.file.type as (typeof POLICY.contentTypes)[number],
          sizeBytes: input.file.size,
          checksumSha256: await sha256Base64(input.file),
          fileName: input.file.name,
        },
      });
      if (created.upload !== null) await uploadToStorage(created.upload, input.file);
      await api.confirmFileUpload({ params: { fileId: created.file.id } });
      return api.attachProtocolMedia({
        params: { testDefinitionId },
        body: { clientUuid: input.attachUuid, fileId: created.file.id, caption: input.caption },
      });
    },
    onSuccess: async (media) => {
      setDone(t('help.media.add.done', { caption: media.caption }));
      setFile(null);
      setCaption('');
      if (fileInput.current !== null) fileInput.current.value = '';
      await queryClient.invalidateQueries({
        queryKey: protocolMediaKey(selection, testDefinitionId),
      });
    },
  });

  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDone(null);
    const trimmed = caption.trim();
    let invalid = false;
    if (file === null) {
      setFileError(t('help.media.add.missingFile'));
      invalid = true;
    } else if (!ACCEPTED.includes(file.type)) {
      setFileError(t('help.media.add.wrongType'));
      invalid = true;
    } else if (file.size < 1 || file.size > POLICY.maxSizeBytes) {
      setFileError(t('help.media.add.tooBig', { maxMb: MAX_MB }));
      invalid = true;
    } else {
      setFileError(null);
    }
    if (trimmed === '') {
      setCaptionError(t('help.media.add.missingCaption'));
      invalid = true;
    } else {
      setCaptionError(null);
    }
    if (invalid || file === null) return;
    add.mutate({
      file,
      caption: trimmed,
      uploadUuid: crypto.randomUUID(),
      attachUuid: crypto.randomUUID(),
    });
  };

  return (
    <form className="sp-form sp-media-form" onSubmit={onSubmit} noValidate>
      <h3 className="sp-card__title">{t('help.media.add.title')}</h3>
      <div className="sp-field">
        <label htmlFor={fileInputId} className="sp-field__label">
          {t('help.media.add.file')}
        </label>
        <input
          ref={fileInput}
          id={fileInputId}
          className="sp-field__input"
          type="file"
          name="file"
          accept={ACCEPTED.join(',')}
          aria-describedby={`${fileInputId}-help${fileError === null ? '' : ` ${fileInputId}-error`}`}
          aria-invalid={fileError === null ? undefined : true}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
          }}
        />
        <p id={`${fileInputId}-help`} className="sp-field__help">
          {t('help.media.add.fileHelp', { maxMb: MAX_MB })}
        </p>
        {fileError === null ? null : (
          <p id={`${fileInputId}-error`} className="sp-field__error">
            <Icon name="critical" />
            <span>{fileError}</span>
          </p>
        )}
      </div>
      <TextField
        label={t('help.media.add.caption')}
        help={t('help.media.add.captionHelp')}
        name="caption"
        required
        maxLength={PROTOCOL_MEDIA_CAPTION_MAX_LENGTH}
        value={caption}
        error={captionError}
        onChange={(event) => {
          setCaption(event.target.value);
        }}
      />
      {add.isError ? <ErrorNotice error={add.error} /> : null}
      {done === null ? null : (
        <Notice level="ok" role="status">
          <p>{done}</p>
        </Notice>
      )}
      <Button type="submit" disabled={add.isPending}>
        {add.isPending ? t('help.media.add.uploading') : t('help.media.add.submit')}
      </Button>
    </form>
  );
}
