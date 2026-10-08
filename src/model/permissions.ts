// Rollen & Rechte. Aktuell gibt es nur einen lokalen Benutzer (Standard: Admin).
// Sobald ein Login/Backend dazukommt, liefert dieses den Benutzer samt Rolle –
// die UI fragt ausschließlich über can() ab und muss dafür nicht umgebaut werden.

import type { Inspection, Role, User } from './types';

export type Action =
  | 'users.manage'
  | 'templates.manage'
  | 'company.manage'
  | 'categories.manage'
  | 'inspection.create'
  | 'inspection.edit'
  | 'inspection.delete'
  | 'pdf.create'
  | 'inspection.view'
  | 'pdf.download';

const MATRIX: Record<Role, Action[]> = {
  admin: [
    'users.manage', 'templates.manage', 'company.manage', 'categories.manage',
    'inspection.create', 'inspection.edit', 'inspection.delete', 'pdf.create', 'inspection.view', 'pdf.download',
  ],
  employee: ['inspection.create', 'inspection.edit', 'pdf.create', 'inspection.view', 'pdf.download', 'categories.manage'],
  viewer: ['inspection.view', 'pdf.download'],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  employee: 'Mitarbeiter',
  viewer: 'Lesender Benutzer',
};

export function can(user: User, action: Action): boolean {
  return MATRIX[user.role].includes(action);
}

/** Darf die Begehung inhaltlich verändert werden? (Abgeschlossene sind schreibgeschützt.) */
export function canEditInspection(user: User, insp: Inspection | null): boolean {
  return !!insp && insp.status !== 'completed' && can(user, 'inspection.edit');
}
