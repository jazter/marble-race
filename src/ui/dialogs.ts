/** In-page modal dialogs: rename a marble, and a generic confirmation (no window.confirm). */
import type { MarbleProfile } from '../core/types';
import { $, el } from './dom';
import { keyOf, customOf, marbleCanvas } from './marbleLabel';
import { setCustomName } from './names';

let openCount = 0;
let closer: (() => void) | null = null;

/** True while any dialog is open (global shortcuts must not fire). */
export function isDialogOpen(): boolean {
  return openCount > 0;
}

export function closeDialog(): void {
  closer?.();
}

function open(card: HTMLElement, initialFocus: HTMLElement, onCancel: () => void): void {
  closeDialog();
  const root = $('dialog');
  const prev = document.activeElement as HTMLElement | null;
  root.innerHTML = '';
  root.append(card);
  root.classList.add('show');
  openCount = 1;

  const close = (): void => {
    if (!openCount) return;
    openCount = 0;
    closer = null;
    root.classList.remove('show');
    root.innerHTML = '';
    root.onkeydown = null;
    root.onpointerdown = null;
    if (prev && document.contains(prev) && prev.offsetParent !== null) prev.focus();
  };
  closer = close;

  root.onpointerdown = (e) => {
    if (e.target === root) {
      onCancel();
      close();
    }
  };
  root.onkeydown = (e) => {
    e.stopPropagation(); // no space / M / etc. shortcuts while a dialog is open
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      close();
    } else if (e.key === 'Tab') {
      const f = Array.from(card.querySelectorAll<HTMLElement>('button, input')).filter((n) => !n.hasAttribute('disabled'));
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  initialFocus.focus();
  if (initialFocus instanceof HTMLInputElement) initialFocus.select();
}

export function openNaming(profile: MarbleProfile): void {
  const key = keyOf(profile);
  const input = el('input', {
    type: 'text',
    class: 'name-input',
    maxlength: '24',
    placeholder: 'Escribe un nombre',
    autocomplete: 'off',
    autocapitalize: 'words',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': 'Nombre de la canica',
  }) as HTMLInputElement;
  const current = customOf(profile);
  input.value = current ?? '';

  const save = (): void => {
    const v = input.value.trim().slice(0, 24);
    setCustomName(key, v ? v : null);
    closeDialog();
  };
  const btn = (label: string, cls: string, fn: () => void) => {
    const b = el('button', { type: 'button', class: `btn ${cls}` }, label);
    b.addEventListener('click', fn);
    return b;
  };
  const remove = btn('Quitar nombre', '', () => {
    setCustomName(key, null);
    closeDialog();
  });
  if (!current) remove.setAttribute('disabled', '');
  const card = el('div', { class: 'dialog-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Nombrar canica' }, [
    el('div', { class: 'dialog-marble' }, [marbleCanvas(profile, 56)]),
    el('h2', {}, 'Nombrar canica'),
    el('p', { class: 'muted' }, `Color: ${profile.name}`),
    input,
    el('div', { class: 'btn-row' }, [btn('Guardar', 'primary', save), remove, btn('Cancelar', '', closeDialog)]),
  ]);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });
  open(card, input, () => {});
}

export function openConfirm(opts: { title: string; message: string; confirmLabel: string; onConfirm: () => void }): void {
  const ok = el('button', { type: 'button', class: 'btn primary' }, opts.confirmLabel);
  ok.addEventListener('click', () => {
    closeDialog();
    opts.onConfirm();
  });
  const cancel = el('button', { type: 'button', class: 'btn' }, 'Cancelar');
  cancel.addEventListener('click', closeDialog);
  const card = el('div', { class: 'dialog-card', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': opts.title }, [
    el('h2', {}, opts.title),
    el('p', { class: 'muted' }, opts.message),
    el('div', { class: 'btn-row' }, [ok, cancel]),
  ]);
  open(card, cancel, () => {});
}

/** Single-line text prompt (save / rename a map). Enter confirms, Esc cancels. */
export function openTextPrompt(opts: {
  title: string;
  message?: string;
  value: string;
  confirmLabel: string;
  maxLength?: number;
  onSubmit: (value: string) => void;
}): void {
  const input = el('input', {
    type: 'text',
    class: 'name-input',
    maxlength: String(opts.maxLength ?? 40),
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': opts.title,
  }) as HTMLInputElement;
  input.value = opts.value;
  const submit = (): void => {
    const v = input.value.trim();
    if (!v) {
      input.focus();
      return;
    }
    closeDialog();
    opts.onSubmit(v);
  };
  const ok = el('button', { type: 'button', class: 'btn primary' }, opts.confirmLabel);
  ok.addEventListener('click', submit);
  const cancel = el('button', { type: 'button', class: 'btn' }, 'Cancelar');
  cancel.addEventListener('click', closeDialog);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  const kids: HTMLElement[] = [el('h2', {}, opts.title)];
  if (opts.message) kids.push(el('p', { class: 'muted' }, opts.message));
  kids.push(input, el('div', { class: 'btn-row' }, [ok, cancel]));
  open(el('div', { class: 'dialog-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title }, kids), input, () => {});
}

/** Information dialog with a single "Entendido" button. */
export function openInfo(title: string, message: string): void {
  const ok = el('button', { type: 'button', class: 'btn primary' }, 'Entendido');
  ok.addEventListener('click', closeDialog);
  const card = el('div', { class: 'dialog-card', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('h2', {}, title),
    el('p', { class: 'muted' }, message),
    el('div', { class: 'btn-row' }, [ok]),
  ]);
  open(card, ok, () => {});
}

let toastTimer: number | undefined;
/** Short non-blocking message at the bottom of the screen. */
export function showToast(text: string): void {
  const t = $('app-toast');
  t.textContent = text;
  t.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
}
