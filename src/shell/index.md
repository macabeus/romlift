# src/shell

The only code that touches the file system, processes, hashing (`node:crypto`) or the environment:
locating and loading a project, reading evidence files, running binutils and agbcc, applying a write
plan atomically under a lock. The shell decides nothing; every policy is a pure function in `core/`
(D17, D36). Only `fs.ts` lists directories, sorted by code unit (D5).
