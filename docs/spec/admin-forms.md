# Admin forms: what's wrong and the plan

An audit of every admin form (2026-10-14, Spanish, at 1280 and 390 px wide; review only) after Dani's "it is very
weird that I cannot upload the logo when creating the party, also the field for the logo [is] really bad (no
preview before uploading, raw file input…) review thoroughly the forms in the admin and improve UX". The sign-in
and account pages are the best forms in the app (Ark `Field`, full-width button) and the pattern to copy.

The work is in PLAN's [queued work](PLAN.md#queued-work), in the order of §3. Each step ships on its own.

## 1. Across the app, and the shared components that fix it

1. **No image or file field.** Logos and source copies use a raw file input styled as a text box, with the
   browser's own "Choose File / No file chosen". No preview, no drag-and-drop, no reset after an upload (the name
   stays, so it looks still pending), and a file can only be added once the record exists.
   - **`ImageField`:** a drop zone plus a button; a local preview (object URL) on a checkerboard; type, size (2 MB)
     and dimension (4096 px) checks in the browser; Replace and Remove; a deferred mode that keeps the file in the
     form and uploads it right after the create call succeeds. For party and organization logos, the site's brand
     images and attestation screenshots.
   - **`FileField`:** the same for documents (a chip with name, size and type; a localized button), for source
     copies and clips.
2. **Errors only in a banner above the button** ("⚠ Falta algo necesario"): no field is marked or focused, and the
   specific messages mapped from constraint names often never fire (a missing party or election name; an invalid
   website plus territories on a party).
   - **`Field`** on Ark's `Field.Root`: label, hint, required or optional, `Field.ErrorText`. Forms get
     `noValidate`; the API answers `{error, field}`; the first invalid field takes focus; long forms get an error
     summary at the top.
3. **Every empty required field looks wrong on load:** `_invalid` in `ui/styles.ts` matches `:invalid`, so an empty
   required input has the error border from the start. The browser's own bubbles also speak its language, not the
   page's. Style only `[aria-invalid=true]`, set after a submit attempt.
4. **No pattern for sections, actions and feedback.** Pages stack small forms, each with its own primary button
   (four on the election overview, five on a cell). Actions are right-aligned on some forms, left on others.
   Success shows in a small muted line or in the announcer at the top of the page, far from the button, and stays.
   Edit forms leave the page on save (party, criterion), and creating gives no confirmation.
   - **`FormSection`** (title, description, body) and **`FormActions`** (left-aligned, one primary, "Guardado ✓"
     beside the button). Stay on the page after an edit; confirm after navigating; destructive actions together at
     the end, in their own block.
5. **Slugs typed by hand, under three names** ("Identificador", "Nombre en la dirección", "Nombre corto", the last
   also a party's short name). **`SlugField`:** filled from the name until edited, showing the public address, one
   label everywhere.
6. **Codes typed by hand:** ISO 3166-2 territories, language and country codes. **`TerritoryPicker`** (the
   country's subdivisions by name), **`LanguageSelect`**, **`CountrySelect`**.
7. **Choices hidden in selects** (election type, triage status, invite role, change field). **`RadioCards`** and
   **`CheckboxCards`** with descriptions, as the roles dialog (R182) does. Checkboxes and radios shrink when their
   label wraps, below 24 px (WCAG 2.5.8): `flexShrink: 0`, and the whole label row as the target.
8. **`LocalizedField`:** the tabs don't say which languages are filled; "necesario para publicar" shows where the
   save itself needs the text; in the short title's 14 rem wrapper the tabs break onto rows. A ✓ or "vacío" per
   tab, the width on the input, and "copiar del español".
9. **Markdown fields** (methodology, legal texts) are small textareas. **`MarkdownEditor`:** grows with its text,
   has a preview tab.
10. **No guard for unsaved changes.** A dirty-state hook, reused.
11. **Phone navigation:** the site's nav, the header and the eight election tabs take about 600 px before any
    content. `SectionNav` as a scrolling strip or a "Sección" select on a phone.

## 2. Per form

### Parties

- **High: no logo when creating; the logo field is raw** (`PartyForm.tsx` has none; `LogoForm.tsx` is a raw input
  with its own submit; the wrong-type error is a one-sentence rule list). `ImageField` inside `PartyForm`, deferred
  on create, immediate on edit; `LogoForm` goes.
- **High: a live party's logo is a dead end.** The page says it changes through a change request, but
  `changes/fields.ts` has no `logo_file_id` for a party (the API's `COLUMN_RULES.party` accepts it). R183's edit
  form takes the logo.
- **High: every new party silently gets grey** (`hasColour` starts true, default `#808080`; the "add party" change
  form too). No colour by default; "Elegir color" plus a hex input.
- **Medium: the party page.** "Editar partido" with no name; Programa, Logotipo, an untitled data form, delete;
  saving goes back to the list; a live party shows none of its data. A header with name, logo and short name; then
  data (logo included), programme, delete; stay on the page; a live party's data read-only, with "Proponer cambio".
- **Medium: programme buttons read as statuses** ("Comprobado: aún no publicado" in orange, right-aligned). A
  "programme state" radio plus "Registrar comprobación de hoy"; say why "publicado" is disabled, with a link to add
  the programme's source.
- **Medium:** territories as codes (picker); the list shows only name and slug (add logo, colour, short name, and
  what's missing).
- **Low:** "Añadir partido" rather than "Guardar" when creating; a hint for the website; "Borrar partido" is both a
  heading and a button.

### Elections

- **Medium: new election.** Type as a select (radio cards); territory as a code after "XE–" (picker); slug not
  from the name; a generic name error; jargon in the intro.
- **Medium: overview.** Four forms with four primary buttons; the settings checkboxes need their own save; the next
  step (preview, go live) sits below them; the checklist has no links and names parties by slug. A status card
  first (state, next step, checklist with links), the details as one form, settings as switches that save on change
  (keeping the confirmation for turning four-eyes off).
- **Medium:** "Borrar elección" is offered when it can only fail: disabled, with the reason. The freeze form's
  inputs are in browser time while its status says UTC; show the zone in both, behind "Programar congelación".
- **Low:** archiving (irreversible) asks no typed confirmation while going live does; the go-live dialog's slug in a
  copyable code style.

### Methodology

- **Medium:** the body is a raw Markdown textarea; the two six-checkbox lists need descriptions and "Seleccionar
  todo"; reviewers order by a number (default 0) while parties and criteria use up and down buttons (reuse
  `OrderedList`); "Persona guardada." shows under the emptied form, not by the new card; delete sits under "Añadir
  persona".
- **Low:** "Institución" here, "Afiliación" in change requests; the reviewer's edit summary is 24 px tall.

### Criteria

- **Medium:** the short title's tabs break; fields in another order than the party form, slug after the
  description; saving goes back to the list with no confirmation.
- **Low:** describe each core criterion in its select.

### Sources

- **Medium: no file when creating.** The copy needs a second page; the language is a code; "Dirección" is
  ambiguous. One form with "Copia: subir archivo / obtener desde el enlace / más tarde" (`FileField`), a
  `LanguageSelect`, "Enlace (URL)".
- **Medium:** the source page shows every detail twice (a fact list, then the same fields as a form). The fact list,
  with an "Editar" toggle while there's no copy.
- **Low:** content type, SHA-256 and "§ 1" units behind "Detalles técnicos"; one verb for deleting
  ("Eliminar fuente", "Borrar partido", "Quitar persona").

### Cells

- **High: a false "someone changed this cell" warning.** Type a summary, then add your own quote: the quote's
  trigger bumps `content_version`, `CellForm` warns "Alguien ha cambiado esta celda…", and reloading as it says
  loses the text. Adopt the new version when the page's own action moved it and keep the edits (or save the draft
  first); warn only for someone else's change; guard against leaving with unsaved edits.
- **Medium:** the checklist and "Enviar a revisión" ignore unsaved text (mark "sin guardar"; save before
  submitting); five submits on one page (a sticky bar with the state, an unsaved marker, Guardar and Enviar); a
  published cell opens straight into an editable draft (an explicit "Corregir o actualizar" step first); on a phone
  the source text comes after the quote form (put it above, or in a sheet); clip times in decimal seconds (mm:ss).
- **Low:** "Como lo comprobará la base de datos al enviarlo."; "acreditada" and "atestiguada" for one thing;
  "Versión 1" means nothing to editors; the comment box is always open and looks like an error.

### Change requests

- **Medium:** one field per request (R183 makes it a full edit form, "Ahora" and "Nuevo" side by side, one note);
  the heading says "Partido Partido Ejemplo A"; "add party" is a third variant (slug first, no hints, no logo, grey
  by default); right-aligned buttons. Reuse the party and criterion forms' fields.

### Reports (right of reply)

- **Medium:** the status select forces "Nuevo" → "Revisado" → a decision, two saves (radios with descriptions,
  deciding from "Nuevo"); no "Proponer un cambio por este mensaje" link, though `changes/new?report=` exists.
- **Low:** "Avisos", "Réplicas y errores" and "mensajes" name one thing; a string says "(PLAN P11)".

### Members and invitations

- **High: an invitation's role defaults to "Coordinación"**, the most powerful. Default to Edición, as radios with
  the roles dialog's descriptions.
- **Medium:** at 390 px the invitations table overflows by 158 px and the audit page by 153 px (WCAG 1.4.10): the
  members table's phone pattern (R182). Accepting an invitation doesn't name the site and says "segundo factor"
  where the rest says "verificación en dos pasos".

### Settings and platform

- **Medium:** no brand images or organization logos in the admin (a script uploads them): `ImageField`. A site's
  name, languages, operator and retention can't change after creation. The new-site form: country as a code, "Otros
  idiomas" repeats the main one, lowercase radio labels, retention with no default, slug labelled "Nombre corto".
  The colour picker has no hex input.
- **Low:** the legal texts' editor is a 160 px textarea; the audit filter offers table names and a row id.
- **D18's note:** the organization form says the legal-notice fields are needed only for an organization that runs
  a site (Dani, 2026-10-14).

### Sign-in and account

- **Low:** the browser's own validation bubbles; the authenticator key wraps mid-group and has no copy button;
  "Cerrar sesión" and "Usar un código de recuperación" are 24 px text buttons.

### Wording (Spanish)

- Language names lowercase mid-sentence ("en español"). One term each for slug, delete, affiliation, attestation,
  reports and two-factor. No internal jargon ("base de datos", "ISO 3166-2", "Markdown", plan references).

## 3. Order

1. **Party form and logo, with R183** (done, PLAN R183): `ImageField` (deferred on create); the logo in
   `PartyForm`; the party page rebuilt, staying on it after a save; no default grey; logos in the list; the logo in
   R183's edit form; the `Field` pattern started here. Plus the invite's default role (Edición) and D18's note.
2. **`Field` and errors everywhere** (done, PLAN R189): field-level errors, `noValidate`, the API naming the field, the
   `_invalid` fix, focus on the first error. "Falta algo necesario" goes. The cell editor's forms come with step 3.
3. **Cell editor** (done, PLAN R190): the false warning, the unsaved-edit guard, the sticky bar.
4. **Phone overflow** of invitations and audit (done, PLAN R191).
5. **`FormSection` and `FormActions`, feedback, `SlugField`, wording** (done, PLAN R192).
6. **Election overview** (done, PLAN R193): status card, linked checklist, switches; delete disabled when it would
   fail; the freeze's time zone.
7. **Sources** (done, PLAN R194): the copy when creating (`FileField`), `LanguageSelect`, one view of the details.
8. **Brand images and organization logos** with `ImageField`; site details editable (done, PLAN R195).
9. **Pickers and the rest** (done, PLAN R196; the territory picker, R201): territory, country and
   language; `MarkdownEditor`; mm:ss; triage radios and the report's change link.
10. **Phone section nav and target sizes** (done, PLAN R197).
