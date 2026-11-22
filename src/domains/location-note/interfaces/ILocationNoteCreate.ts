import { LocationNote } from '@prisma/types'

// What a new note is made from. `lastConfirmedAt` starts at the database's now() (spec 0053).
export type ILocationNoteCreate = Omit<LocationNote, 'id' | 'createdAt' | 'updatedAt' | 'lastConfirmedAt'>
