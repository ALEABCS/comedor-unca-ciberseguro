import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  CalendarDays, CalendarRange, Clock3, ImagePlus, MapPin, Megaphone, Newspaper, Pencil, Plus,
  Save, Send, Trash2, X
} from "lucide-react";
import { trpc } from "./trpc";

type EntryType = "NOTICIA" | "COMUNICADO" | "EVENTO";
type Visibility = "PUBLICO" | "PRIVADO";
type EventStatus = "PROGRAMADO" | "REALIZADO" | "CANCELADO";
type Entry = {
  id: string;
  type: EntryType;
  visibility: Visibility;
  title: string;
  body: string;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  eventStatus: EventStatus;
  published: boolean;
  createdAt: string;
  photoIds: string[];
};
type Draft = {
  type: EntryType;
  visibility: Visibility;
  title: string;
  body: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  eventStatus: EventStatus;
  published: boolean;
};
type Filter = "TODOS" | EntryType;

const emptyDraft: Draft = {
  type: "NOTICIA",
  visibility: "PUBLICO",
  title: "",
  body: "",
  eventDate: "",
  startTime: "",
  endTime: "",
  location: "",
  eventStatus: "PROGRAMADO",
  published: false
};

const entryTypes: { id: Filter; label: string }[] = [
  { id: "TODOS", label: "Todo" },
  { id: "NOTICIA", label: "Noticias" },
  { id: "COMUNICADO", label: "Comunicados" },
  { id: "EVENTO", label: "Eventos especiales" }
];

const typeNames: Record<EntryType, string> = {
  NOTICIA: "Noticia",
  COMUNICADO: "Comunicado",
  EVENTO: "Evento especial"
};

const eventStatusNames: Record<EventStatus, string> = {
  PROGRAMADO: "Programado",
  REALIZADO: "Realizado",
  CANCELADO: "Cancelado"
};

function formatEventDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "long" }).format(date);
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}

export function EventsNews({ canManage, canViewPrivate, demoMode }: { canManage: boolean; canViewPrivate: boolean; demoMode: boolean }) {
  const [filter, setFilter] = useState<Filter>("TODOS");
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const selectedUpload = useRef<Entry | null>(null);
  const entries = trpc.eventsNews.list.useQuery();
  const utils = trpc.useUtils();
  const createEntry = trpc.eventsNews.create.useMutation();
  const updateEntry = trpc.eventsNews.update.useMutation();
  const removeEntry = trpc.eventsNews.remove.useMutation();
  const removePhoto = trpc.eventsNews.removePhoto.useMutation();
  const visibleEntries = (entries.data ?? []).filter((entry) => filter === "TODOS" || entry.type === filter);
  const isSaving = createEntry.isPending || updateEntry.isPending;

  function startNew() {
    setError("");
    setFeedback("");
    setEditing({ id: null, draft: { ...emptyDraft } });
  }

  function startEditing(entry: Entry) {
    setError("");
    setFeedback("");
    setEditing({
      id: entry.id,
      draft: {
        type: entry.type,
        visibility: entry.visibility,
        title: entry.title,
        body: entry.body,
        eventDate: entry.eventDate ?? "",
        startTime: entry.startTime ?? "",
        endTime: entry.endTime ?? "",
        location: entry.location ?? "",
        eventStatus: entry.eventStatus,
        published: entry.published
      }
    });
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setError("");
    setFeedback("");
    const { draft, id } = editing;
    const input = {
      type: draft.type,
      visibility: draft.visibility,
      title: draft.title.trim(),
      body: draft.body.trim(),
      eventDate: draft.type === "EVENTO" ? draft.eventDate : null,
      startTime: draft.type === "EVENTO" ? draft.startTime : null,
      endTime: draft.type === "EVENTO" ? draft.endTime : null,
      location: draft.type === "EVENTO" ? draft.location.trim() : null,
      eventStatus: draft.eventStatus,
      published: draft.published
    } as const;
    try {
      if (id) await updateEntry.mutateAsync({ id, ...input });
      else await createEntry.mutateAsync(input);
      await utils.eventsNews.list.invalidate();
      setEditing(null);
      setFeedback(input.published
        ? input.visibility === "PRIVADO"
          ? "El informe reservado ya está disponible para el Administrador Local y el Supervisor."
          : "La publicación quedó visible para la comunidad."
        : "El contenido se guardó como borrador privado para el Administrador Local.");
    } catch (cause) {
      setError(readableError(cause));
    }
  }

  async function setPublication(entry: Entry, published: boolean) {
    setError("");
    setFeedback("");
    try {
      await updateEntry.mutateAsync({
        id: entry.id,
        type: entry.type,
        visibility: entry.visibility,
        title: entry.title,
        body: entry.body,
        eventDate: entry.eventDate,
        startTime: entry.startTime,
        endTime: entry.endTime,
        location: entry.location,
        eventStatus: entry.eventStatus,
        published
      });
      await utils.eventsNews.list.invalidate();
      setFeedback(published
        ? entry.visibility === "PRIVADO"
          ? "El informe reservado ya está disponible para el Administrador Local y el Supervisor."
          : "La publicación ya está visible para la comunidad."
        : "La publicación se retiró de la vista de usuarios.");
    } catch (cause) {
      setError(readableError(cause));
    }
  }

  async function deleteEntry(entry: Entry) {
    if (!window.confirm(`¿Eliminar “${entry.title}” y las fotos asociadas? Esta acción no se puede deshacer.`)) return;
    setError("");
    setFeedback("");
    try {
      await removeEntry.mutateAsync({ id: entry.id });
      await utils.eventsNews.list.invalidate();
      setFeedback("El contenido se eliminó.");
    } catch (cause) {
      setError(readableError(cause));
    }
  }

  function beginPhotoUpload(entry: Entry) {
    setError("");
    selectedUpload.current = entry;
    photoInput.current?.click();
  }

  async function uploadPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    const entry = selectedUpload.current;
    event.currentTarget.value = "";
    if (!entry || !files.length) return;
    if (entry.photoIds.length + files.length > 10) {
      setError(`Cada publicación admite hasta 10 fotos. Podés agregar ${Math.max(0, 10 - entry.photoIds.length)} más.`);
      return;
    }
    const invalid = files.find((file) =>
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024
    );
    if (invalid) {
      setError("Cada archivo debe ser PNG, JPEG o WebP y pesar hasta 5 MB.");
      return;
    }

    setUploadingId(entry.id);
    setError("");
    setFeedback("");
    let uploaded = 0;
    try {
      for (const file of files) {
        const response = await fetch(`/api/events-news/${entry.id}/photos`, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file
        });
        if (!response.ok) {
          const result = await response.json() as { error?: string };
          throw new Error(result.error ?? "No se pudo subir una de las fotos.");
        }
        uploaded += 1;
      }
      await utils.eventsNews.list.invalidate();
      setFeedback(`${uploaded} ${uploaded === 1 ? "foto agregada" : "fotos agregadas"} a la publicación.`);
    } catch (cause) {
      await utils.eventsNews.list.invalidate();
      setError(uploaded ? `${uploaded} foto(s) se guardaron antes del error. ${readableError(cause)}` : readableError(cause));
    } finally {
      setUploadingId(null);
    }
  }

  async function deletePhoto(photoId: string) {
    if (!window.confirm("¿Quitar esta foto de la publicación?")) return;
    setError("");
    try {
      await removePhoto.mutateAsync({ id: photoId });
      await utils.eventsNews.list.invalidate();
      setFeedback("La foto se quitó de la publicación.");
    } catch (cause) {
      setError(readableError(cause));
    }
  }

  return (
    <section className="events-news-page">
      <div className="page-intro">
        <div>
          <div className="eyebrow">COMEDOR UNIVERSITARIO</div>
          <h1>Eventos Especiales y Noticias</h1>
          <p>Noticias, comunicados importantes y actividades especiales del Comedor Universitario.</p>
        </div>
        {canManage && !demoMode && <button className="button button-primary" type="button" onClick={startNew}><Plus size={17} /> Nuevo contenido</button>}
      </div>

      {canManage && demoMode && <div className="notice-message" role="status">En el entorno de demostración podés consultar publicaciones, pero no modificarlas.</div>}
      {feedback && <div className="notice-message notice-success" role="status">{feedback}</div>}
      {error && <div className="notice-message notice-error" role="alert">{error}</div>}
      {entries.error && <div className="notice-message notice-error" role="alert">{readableError(entries.error)}</div>}

      {editing && canManage && !demoMode && (
        <form className="surface-card events-news-editor" onSubmit={(event) => void saveEntry(event)}>
          <div className="surface-heading">
            <div><span className="eyebrow">{editing.id ? "EDICIÓN" : "NUEVA PUBLICACIÓN"}</span><h2>{editing.id ? "Editar contenido" : "Crear contenido"}</h2></div>
            <button className="icon-button" type="button" aria-label="Cerrar editor" onClick={() => setEditing(null)}><X size={18} /></button>
          </div>
          <div className="events-news-form-grid">
            <label className="field">Tipo de contenido
              <select value={editing.draft.type} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, type: event.target.value as EntryType } })}>
                <option value="NOTICIA">Noticia</option>
                <option value="COMUNICADO">Comunicado importante</option>
                <option value="EVENTO">Reserva de evento especial</option>
              </select>
            </label>
            <label className="field">Visibilidad
              <select value={editing.draft.visibility} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, visibility: event.target.value as Visibility } })}>
                <option value="PUBLICO">Público · toda la comunidad</option>
                <option value="PRIVADO">Privado · Administrador Local y Supervisor</option>
              </select>
            </label>
            <label className="field">Título
              <input required minLength={3} maxLength={180} value={editing.draft.title} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, title: event.target.value } })} />
            </label>
          </div>
          <label className="field">{editing.draft.visibility === "PRIVADO" ? "Informe y detalles reservados" : "Descripción e información"}
            <textarea required minLength={3} maxLength={5000} rows={5} value={editing.draft.body} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, body: event.target.value } })} />
          </label>
          {editing.draft.type === "EVENTO" && (
            <div className="events-news-form-grid">
              <label className="field">Fecha del evento<input type="date" required value={editing.draft.eventDate} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, eventDate: event.target.value } })} /></label>
              <div className="events-news-form-grid events-news-time-fields">
                <label className="field">Desde<input type="time" required value={editing.draft.startTime} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, startTime: event.target.value } })} /></label>
                <label className="field">Hasta<input type="time" required value={editing.draft.endTime} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, endTime: event.target.value } })} /></label>
              </div>
              <label className="field">Lugar<input required maxLength={180} value={editing.draft.location} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, location: event.target.value } })} placeholder="Salón del comedor" /></label>
              <label className="field">Estado del evento
                <select value={editing.draft.eventStatus} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, eventStatus: event.target.value as EventStatus } })}>
                  <option value="PROGRAMADO">Programado</option>
                  <option value="REALIZADO">Realizado</option>
                  <option value="CANCELADO">Cancelado</option>
                </select>
              </label>
            </div>
          )}
          <label className="events-news-publish-toggle">
            <input type="checkbox" checked={editing.draft.published} onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, published: event.target.checked } })} />
            <span><strong>{editing.draft.visibility === "PRIVADO" ? "Publicar informe reservado" : "Publicar para la comunidad"}</strong><small>{editing.draft.visibility === "PRIVADO" ? "El contenido y sus fotos solo estarán disponibles para el Administrador Local y el Supervisor." : "El contenido y sus fotos serán visibles para el alumnado, docentes y personal no docente."} Si no se publica, solo lo verá el Administrador Local.</small></span>
          </label>
          <div className="events-news-editor-actions">
            <button className="button button-primary" type="submit" disabled={isSaving}>{editing.draft.published ? <Send size={16} /> : <Save size={16} />}{isSaving ? " Guardando…" : editing.draft.published ? editing.draft.visibility === "PRIVADO" ? " Publicar informe privado" : " Publicar" : " Guardar borrador"}</button>
            <button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="events-news-toolbar">
        <div className="events-news-filters" role="group" aria-label="Filtrar publicaciones">
          {entryTypes.map((item) => <button key={item.id} type="button" className={filter === item.id ? "events-news-filter-active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
        </div>
        {canManage && <span className="events-news-admin-note"><Megaphone size={15} /> El Administrador Local administra publicaciones públicas e informes privados.</span>}
        {!canManage && canViewPrivate && <span className="events-news-admin-note"><Megaphone size={15} /> Los informes privados son visibles para el Administrador Local y el Supervisor.</span>}
      </div>

      {entries.isLoading ? <div className="surface-card events-news-empty" role="status">Cargando publicaciones…</div> :
        visibleEntries.length === 0 ? <div className="surface-card events-news-empty"><Newspaper size={28} /><h2>{filter === "TODOS" ? "Todavía no hay publicaciones" : `Todavía no hay ${entryTypes.find((item) => item.id === filter)?.label.toLowerCase()}`}</h2><p>{canManage ? "Creá una noticia, un comunicado o un evento especial para empezar." : "Cuando el comedor comparta noticias y actividades, aparecerán acá."}</p></div> :
          <div className="events-news-list">{visibleEntries.map((entry) => (
            <article className={`surface-card events-news-card events-news-card-${entry.type.toLowerCase()}`} key={entry.id}>
              <div className="events-news-card-head">
                <span className={`events-news-type events-news-type-${entry.type.toLowerCase()}`}>
                  {entry.type === "NOTICIA" ? <Newspaper size={15} /> : entry.type === "COMUNICADO" ? <Megaphone size={15} /> : <CalendarRange size={15} />}
                  {typeNames[entry.type]}
                </span>
                {(canManage || canViewPrivate) && <span className={`events-news-visibility ${entry.visibility === "PRIVADO" ? "is-private" : entry.published ? "is-published" : "is-draft"}`}>{entry.visibility === "PRIVADO" ? "Informe reservado · Admin y Supervisor" : entry.published ? "Público · Comunidad" : "Borrador · Solo Admin"}</span>}
                {entry.type === "EVENTO" && <span className={`events-news-status events-news-status-${entry.eventStatus.toLowerCase()}`}>{eventStatusNames[entry.eventStatus]}</span>}
              </div>
              <h2>{entry.title}</h2>
              {entry.type === "EVENTO" && entry.eventDate && (
                <div className="events-news-event-details">
                  <span><CalendarDays size={15} />{formatEventDate(entry.eventDate)}</span>
                  {entry.startTime && entry.endTime && <span><Clock3 size={15} />{entry.startTime}–{entry.endTime}</span>}
                  {entry.location && <span><MapPin size={15} />{entry.location}</span>}
                </div>
              )}
              {entry.visibility === "PRIVADO" && canViewPrivate && <span className="events-news-report-label">Informe reservado para el Administrador Local y el Supervisor</span>}
              <p className="events-news-body">{entry.body}</p>
              {entry.photoIds.length > 0 && <div className="events-news-gallery">
                {entry.photoIds.map((photoId, index) => <div className="events-news-photo" key={photoId}>
                  <img src={`/api/events-news/photos/${photoId}`} alt={`${entry.title}, foto ${index + 1}`} loading="lazy" />
                  {canManage && !demoMode && <button type="button" className="events-news-photo-remove" aria-label={`Quitar foto ${index + 1}`} onClick={() => void deletePhoto(photoId)}><X size={16} /></button>}
                </div>)}
              </div>}
              {canManage && !demoMode && <div className="events-news-management">
                <button className="button button-secondary" type="button" onClick={() => startEditing(entry)}><Pencil size={15} /> Editar</button>
                <button className="button button-secondary" type="button" onClick={() => void setPublication(entry, !entry.published)}><Send size={15} />{entry.published ? " Retirar" : " Publicar"}</button>
                <button className="button button-secondary" type="button" disabled={uploadingId === entry.id || entry.photoIds.length >= 10} onClick={() => beginPhotoUpload(entry)}><ImagePlus size={15} />{uploadingId === entry.id ? " Subiendo…" : ` Fotos ${entry.photoIds.length}/10`}</button>
                <button className="button button-secondary events-news-delete" type="button" onClick={() => void deleteEntry(entry)}><Trash2 size={15} /> Eliminar</button>
              </div>}
            </article>
          ))}</div>}
      {canManage && !demoMode && <input ref={photoInput} className="events-news-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void uploadPhotos(event)} />}
    </section>
  );
}
