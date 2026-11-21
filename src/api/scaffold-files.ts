// romlift/node's template reader (architecture §6.3, roadmap 4.B, D74 i): the manifest, the template texts and the
// pinned agbcc, read from the package's templates/ directory.
export {
  AGBCC_PIN_FILE,
  readAgbccPin,
  readTemplates,
  TEMPLATES_DIR,
  TEMPLATES_MANIFEST,
} from '../shell/project/templates.ts';
