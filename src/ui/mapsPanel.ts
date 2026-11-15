/** "Mis mapas" section of the config panel: list, load, rename, delete, export, import. */
import { $, el } from './dom';
import { openConfirm, openInfo, openTextPrompt, showToast } from './dialogs';
import { deleteMap, exportMaps, importMaps, listMaps, renameMap, type SavedMap } from './savedMaps';

export interface MapsPanelHandlers {
  onLoad: (m: SavedMap) => void;
  /** Called whenever the saved list changes (welcome button count etc.). */
  onChange: (count: number) => void;
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export class MapsPanel {
  readonly details: HTMLDetailsElement;
  private list = el('div', { class: 'maps-list' });
  private msg = el('p', { class: 'maps-msg', hidden: '' });
  private file = el('input', { type: 'file', accept: '.json,application/json', hidden: '' }) as HTMLInputElement;

  constructor(
    /** The section is inserted right after this element (the "Apariencia" section). */
    after: Element | null,
    root: HTMLElement,
    private h: MapsPanelHandlers,
  ) {
    this.details = el('details', { class: 'sec', id: 'sec-maps' }) as HTMLDetailsElement;
    this.details.append(el('summary', {}, [el('span', { class: 'sec-icon' }, '⭐'), el('span', { id: 'maps-title' }, 'Mis mapas')]));
    const exp = el('button', { type: 'button', class: 'btn', id: 'btn-maps-export' }, '⬇ Exportar');
    const imp = el('button', { type: 'button', class: 'btn', id: 'btn-maps-import' }, '⬆ Importar');
    exp.addEventListener('click', () => this.doExport());
    imp.addEventListener('click', () => this.file.click());
    this.file.id = 'maps-file';
    this.file.addEventListener('change', () => void this.doImport());
    this.details.append(el('div', { class: 'sec-body' }, [this.list, el('div', { class: 'maps-tools' }, [exp, imp]), this.msg, this.file]));
    if (after) after.after(this.details);
    else root.append(this.details);
    this.render();
  }

  /** Open the section and bring it into view. */
  reveal(): void {
    this.details.open = true;
    this.details.scrollIntoView({ block: 'start' });
  }

  render(): void {
    const maps = listMaps();
    $('maps-title').textContent = maps.length ? `Mis mapas (${maps.length})` : 'Mis mapas';
    this.list.innerHTML = '';
    if (!maps.length) {
      this.list.append(el('p', { class: 'maps-empty' }, 'Aún no tienes mapas guardados. Cuando un mapa te guste, pulsa «⭐ Guardar mapa» en la vista previa o en el podio y aparecerá aquí.'));
    }
    for (const m of maps) this.list.append(this.item(m));
    this.h.onChange(maps.length);
  }

  private item(m: SavedMap): HTMLElement {
    const btn = (label: string, title: string, cls: string, fn: () => void) => {
      const b = el('button', { type: 'button', class: `btn ${cls}`, title, 'aria-label': title }, label);
      b.addEventListener('click', fn);
      return b;
    };
    return el('div', { class: 'map-item', 'data-id': m.id }, [
      el('div', { class: 'map-name' }, m.name),
      el('div', { class: 'map-meta' }, `${fmtDate(m.savedAt)} · ${m.marbles} canicas · ${m.segments} segmentos · ${m.monsters} monstruos · semilla ${m.seed}`),
      el('div', { class: 'map-actions' }, [
        btn('▶ Cargar', 'Cargar este mapa', 'primary grow', () => this.h.onLoad(m)),
        btn('✎', 'Renombrar', 'icon', () =>
          openTextPrompt({
            title: 'Renombrar mapa',
            value: m.name,
            confirmLabel: 'Guardar',
            onSubmit: (v) => {
              if (renameMap(m.id, v)) this.render();
            },
          }),
        ),
        btn('🗑', 'Borrar', 'icon', () =>
          openConfirm({
            title: 'Borrar mapa',
            message: `¿Borrar «${m.name}»? No se puede deshacer.`,
            confirmLabel: 'Borrar',
            onConfirm: () => {
              deleteMap(m.id);
              this.render();
            },
          }),
        ),
      ]),
    ]);
  }

  private say(text: string): void {
    this.msg.textContent = text;
    this.msg.hidden = !text;
  }

  private doExport(): void {
    if (!listMaps().length) {
      this.say('No hay mapas guardados para exportar.');
      return;
    }
    const blob = new Blob([exportMaps()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `mis-mapas-canicas-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.say('');
    showToast('Mapas exportados');
  }

  private async doImport(): Promise<void> {
    const f = this.file.files?.[0];
    this.file.value = '';
    if (!f) return;
    let text = '';
    try {
      text = await f.text();
    } catch {
      this.say('No se pudo leer el archivo.');
      return;
    }
    const r = importMaps(text);
    if (r.error === 'invalid') this.say('El archivo no es válido: no contiene mapas guardados.');
    else if (r.error === 'quota') {
      this.say('');
      openInfo('No hay espacio', 'El navegador no tiene espacio suficiente para importar estos mapas. Borra alguno e inténtalo de nuevo.');
    } else {
      this.say(r.added ? `Se añadieron ${r.added} mapa(s)${r.skipped ? `; ${r.skipped} omitido(s) (repetidos, no válidos o por el límite de 30)` : ''}.` : `No se añadió ninguno${r.skipped ? ': ya estaban guardados o no eran válidos' : ''}.`);
      this.render();
    }
  }
}
