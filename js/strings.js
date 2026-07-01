'use strict';

// ----------------------------------------------------------------
// All user-visible text strings for the UI.
// Edit this file to change button tooltips, page help text, and
// table column names and order.
// TOOLTIPS: element id → tooltip string (shown on hover)
// HELP:     view id   → HTML shown in the collapsible help panel
// PAGES:    page id   → HTML shown in static help pages
// TABLES:   table id  → array of { id, label, title } column defs
//   id    — stable identifier used by call sites to wire render fns;
//            never change this
//   label — column header text shown in the UI; safe to rename
//   title — tooltip shown on the column header
// ----------------------------------------------------------------

export const TOOLTIPS = {
  // Header
  'btn-nav-toggle':              'Open / close the navigation menu',
  'btn-app-about':               'About RaceMaster',
  'btn-app-whats-new':           "What's new in this version",
  'btn-app-update':              'A new version of RaceMaster is available — click to apply it',

  // Datasets view
  'btn-export-state':            'Export all event data as a JSON backup file',
  'btn-import-state':            'Import event data from a JSON backup file',

  // Event settings
  'ev-name':                     'The name of the race event',
  'ev-date':                     'The date of the race',
  'ev-distance':                 'Race distance in kilometres',
  'ev-categories':               'Age category scheme — FRA uses 5-year bands, WFRA uses 10-year bands',
  'ev-first-bib':                'Bib numbers are assigned sequentially starting from this number',
  'ev-first-dibber':             'Dibber (SI card) short codes are allocated starting from this number',
  'ev-has-pairs':                'Tick if the race includes pairs (two competitors sharing a single bib and/or dibber)',
  'ev-start-time':               'Expected mass start time for seniors (info only, the actual time is recorded in the finishers list)',
  'ev-entry-limit':              'Maximum number of senior entries allowed (0 = no limit)',
  'ev-timing-method':            'How senior finish times are recorded — Stopwatch (manual entry), Dibbers (SportIdent), or None',
  'ev-male-record':              'Current male course record — used to highlight new records in the results',
  'ev-female-record':            'Current female course record — used to highlight new records in the results',
  'ev-junior-start-time':        'Expected mass start time for juniors (info only, the actual time is recorded in the finishers list)',
  'ev-junior-limit-n':           'Maximum number of junior entries (0 = no limit)',
  'ev-junior-timing':            'Timing method for juniors — same options as seniors',
  'ev-junior-limit':             'Competitors at or below this age category are treated as juniors (auto during registration)',
  'ev-prize-overall':            'Number of overall prizes (e.g. 3 = 1st, 2nd, 3rd place overall)',
  'ev-prize-per-cat':            'Number of prizes awarded per senior age category',
  'ev-prize-junior-cat':         'Number of prizes awarded per junior age category',
  'ev-organisation':             'Name of the organising club or body — appears on printed forms',
  'ev-clear-previous':           'Tick before saving to wipe all entries, pre-entries, finisher and results data and start fresh for a new race',
  'btn-save-event':              'Save all event settings',

  // Pre-entries
  'btn-import-si-entries':       'Import a pre-entry CSV file from SportIdent or EntryCentral or anything that provides entry-number, name, gender and date-of-birth columns',
  'btn-clear-pre-entries':       'Clear all pre-entries',

  // Paperwork
  'btn-print-entry-form':          'Print blank entry forms for (solo) competitors to fill in at registration',
  'btn-print-pre-entry-forms':     'Print entry forms pre-filled with pre-entry details — load pre-entries first',
  'btn-print-pairs-entry-forms':            'Print blank pairs entry forms with two entrant sections and two signature lines',
  'btn-print-pre-entry-pairs-entry-forms':  'Print pairs entry forms pre-filled with pre-entry details — load pre-entries first',
  'btn-print-helpers-list':        'Print a blank helpers list for the RO to record names and roles on race day',
  'btn-print-finish-senior':     'Print a blank senior finish sheet for recording finish order',
  'btn-print-finish-junior':     'Print a blank junior finish sheet for recording finish order',
  'btn-print-number-matrix':     'Print a 2D grid showing all bib numbers for cross-checking at CPs',
  'bib-first':                   'First bib number to print — must be between 1 and 999',
  'bib-count':                   'Number of bibs to print — first + count must not exceed 999',
  'btn-print-bibs':              'Print race bibs 2-up on A4; guillotine the stack to produce two sorted A5 piles',

  // Entries
  'btn-export-entries-si':       'Export the entry list as a CSV for importing into the SI Timing system (for when using dibbers)',
  'btn-clear-all-entries':       'Delete all entries — cannot be undone',
  'entry-form-type':             'Solo entry or pair (two competitors sharing one bib and dibber)',
  'entry-form-peno':             'Pre-entry reference number — auto-fills details from the pre-entries list; or just type a name',
  'entry-form-bib':              'Bib number — assigned automatically in sequence; edit to override',
  'entry-form-dibber':           'SI card (dibber) short code — assigned automatically in sequence; edit to override',
  'entry-form-name':             "Competitor's full name — type to search the people database",
  'entry-form-dob':              'Date of birth (DD/MM/YY) — used to determine age category',
  'entry-form-gender':           'Gender — used to determine age category',
  'entry-form-club':             "Competitor's running club",
  'entry-form-fra':              'FRA (Fell Runners Association) registration number',
  'entry-form-category':         'Age category — leave as auto to determine from date of birth and gender',
  'entry-form-course':           'Race course — leave as auto to determine from age category',
  'btn-submit-entry':            'Register this competitor and add them to the entry list',
  'btn-reset-entry':             'Clear the form ready to register the next competitor (auto on register)',
  'btn-cancel-edit':             'Cancel editing and return to the entry list',

  // Helpers
  'btn-clear-all-helpers':       'Delete all helper records — cannot be undone',
  'helper-form-name':            "Helper's full name",
  'helper-form-gender':          'Gender',
  'helper-form-dob':             'Date of birth (DD/MM/YY) - optional',
  'helper-form-club':            'Running club - optional',
  'helper-form-role':            "Helper's role — e.g. Timekeeper, Marshal, Registration",
  'helper-form-role-desc':       'Description of the role — filled automatically for known roles',
  'btn-submit-helper':           'Add this helper to the list',
  'btn-reset-helper':            'Clear the form',
  'btn-cancel-helper-edit':      'Cancel editing',

  // Finishers
  'btn-clear-all-finishers':     'Delete all finisher records — cannot be undone',
  'finisher-mode':               'Bibs mode: enter bib numbers as competitors finish; Time mode: enter times against already-recorded bibs',
  'finisher-line':               'Current position in the finish order (read-only)',
  'finisher-bib':                'Race (bib) number of the finisher, or a special code (DNF etc.)',
  'finisher-prev-time':          'Time recorded for the previous finisher (read-only)',
  'finisher-time':               'Finish time or elapsed time — enter as ss, mm:ss or hh:mm:ss; use - to skip, any separator works, e.g. space',
  'finisher-is-finish':          'Record this as a normal finish',
  'finisher-is-start':           'Record this as an individual start time (for competitors who started early or late)',
  'finisher-is-retire':          'Record this competitor as a retiree / did not finish (DNF)',
  'btn-submit-finisher':         'Record this finisher - the form auto resets ready for the next record',
  'btn-cancel-finisher-edit':    'Cancel editing',

  // SI Results
  'btn-import-si-results':       'Import an SI Timing (processable) results CSV file to load finish times when using dibbers',
  'btn-clear-si-results':        'Delete all imported SI results — cannot be undone',

  // Results
  'btn-print-prize-list':        'Print the prize list for the presentation',
  'btn-export-results-csv':      'Export results as a CSV spreadsheet for publication or DIY manipulation',
  'btn-publish-results':         'Publish results online',
  'btn-show-embed-code':         'Open the published results page in a new tab',
  'published-url-field':        'Click to copy this URL to the clipboard',

  // People
  'people-filter':               'Filter the people list by name or club',
  'people-show-banned':          'Show competitors who are currently banned from competition',
  'btn-show-all-people':         'Clear the filter and show all people',
  'btn-export-people':           'Export the people database as a CSV file',
  'btn-import-people':           'Import people records from a CSV file',
  'btn-merge-people':            'Merge people records from another dataset or JSON backup file',
  'btn-find-dupes':              'Find possible duplicate people records based on name similarity',
  'btn-clear-people':            'Delete all people records — cannot be undone',
  'btn-close-dupes':             'Close the duplicates panel',
  'people-merge-ds-select':      'Dataset to merge people from',
  'btn-do-merge-ds':             'Merge people from the selected dataset into this one',
  'btn-merge-from-file':         'Merge people from a JSON file exported from another dataset',
  'btn-cancel-merge':            'Cancel the merge operation',

  // Clubs
  'btn-merge-clubs':             'Merge the selected clubs into a single club',
  'btn-find-dupe-clubs':         'Find possible duplicate club names',
  'clubs-merge-name':            'Name to merge the selected clubs into — can be an existing club or a new name',
  'btn-do-merge-clubs':          'Perform the merge',
  'btn-cancel-merge-clubs':      'Cancel',
  'btn-close-dupe-clubs':        'Close the duplicate clubs panel',

  // Roles
  'btn-add-role':                'Add a new helper role',
  'btn-export-roles':            'Export roles as a CSV file',
  'btn-import-roles':            'Import roles from a CSV file',
  'btn-reset-roles':             'Restore the built-in default roles',
  'btn-clear-roles':             'Delete all roles - cannot be undone',

  // Dibbers
  'btn-add-dibber':              'Add a dibber (SI card) record manually',
  'btn-import-dibbers':          'Import dibber records from a CSV file',
  'btn-export-dibbers':          'Export dibber records as a CSV file',
  'btn-clear-dibbers':           'Delete all dibber records - cannot be undone',

  // Categories
  'btn-add-category':            'Add a new row to the custom categories',
  'btn-load-fra-preset':         'Copy the built-in FRA categories into the custom list (replaces any existing custom categories)',
  'btn-load-wfra-preset':        'Copy the built-in WFRA categories into the custom list (replaces any existing custom categories)',
  'btn-import-categories-csv':   'Import custom categories from a CSV file (replaces any existing custom categories)',
  'btn-export-categories-csv':   'Export custom categories to a CSV file',
  'btn-clear-categories':        'Delete all custom categories',

  // Data file / auth
  'df-username':                 'Your RaceMaster username — use only letters, numbers and hyphens',
  'df-password':                 'Your RaceMaster password — use anything, its encrypted on the server',
  'df-btn-login':                'Sign in to your RaceMaster account',
  'df-btn-create-account':       'Create a new RaceMaster account',
  'df-btn-standalone':           'Use RaceMaster without a server — data is stored locally in this browser only',
  'df-btn-connect-push':         'Push pending local data changes to the server and connect to this dataset',
  'df-btn-connect-discard':      'Discard local changes and connect to this dataset from the server',
  'df-btn-connect-cancel':       'Cancel',
  'df-copy-name':                'Name for the new copy of this dataset',
  'df-btn-do-copy':              'Create the copy',
  'df-btn-cancel-copy':          'Cancel',
  'df-save-as-name':             'Name for the new dataset',
  'df-btn-do-save-as':           'Save the current data as a new dataset with this name (useful as a record post-race)',
  'df-btn-cancel-save-as':       'Cancel',
  'df-new-dataset-name':         'Name for the new dataset — use only letters, numbers and hyphens',
  'df-btn-create-dataset':       'Create a new empty dataset',
  'df-btn-save-as':              'Save the current data as a new dataset with a different name',
  'df-btn-logout':               'Sign out of your RaceMaster account',
};

export const HELP = {
  'view-home': `
    <p>The <strong>Home</strong> page shows a summary of the current event. Before you can do anything, 
        open <strong>Datasets</strong> page to log-in and select an existing event file or create a new one.</p>
    <p>Follow the <strong>Getting Started</strong> steps in order — they cover the typical workflow from setup through to results.</p>
    <p>It is recommended you create a <strong>master</strong> dataset to use as a template for all events,
        then after the race is over and all results published save it as a new dataset with a name that reflects the name and date of the event.
        That way your people database will accumulate and make future registrations easier.</p>
  `,
  'view-event': `
    <p>Set up the race details before printing paperwork or registering competitors.</p> 
    <p>The <strong>distance</strong> is used to split entrants into juniors or seniors according the FRA distance rules for juniors.</p>
    <p>The <strong>category scheme</strong> (FRA 5-year or WFRA 10-year) controls which age bands are used for results and prizes.</p>
    <p>The <strong>timing method</strong> determines how finishers are recorded.</p> 
    <p>All fields can be updated at any point. However, be wary of the <strong>Clear previous event</strong> checkbox, 
        which will reset all data and settings ready for a new event. 
        Use this once as you setup for a new race to clear all previous event specific data.</p>
   <p>The <strong>Has pairs</strong> option when checked enables pairs races.
        A pair in this context is two people racing together under the same bib (and dibber) number. 
        In Shropshire an example pairs race is the <strong>Time Trial</strong> held each year in November.</p>
  `,
  'view-pre-entries': `
    <p>Import a pre-entry list from a CSV file. Pre-entered competitors can have their details pre-printed on entry forms from the <strong>Paperwork</strong> page.</p>
    <p>Pre-entries can be imported from any source that provides the minimum information required for entries, 
        the minimum is: entrant number, first name, last name, gender and date of birth (SI Entries and Entry Central, at least, meet this requirement).</p>
  `,
  'view-forms': `
    <p>The <strong>Paperwork</strong> page provides facilities to print all the pre-race paperwork.</p>
    <p>Use <strong>Print Blank Entry Forms</strong> to generate one A4 page containing two entry forms, 
        print that as many times as required then guillotine into A5 sheets with one form per sheet.
        These are for solo races. Use <strong>Print Blank Pairs Entry Forms</strong> for pairs races.</p>
    <p>Use <strong>Print Pre-Entry Forms</strong> to generate multiple A4 pages with filled in entry forms, one for each pre-entry.
        They are generated two per A4 page in alphabetical order of surname in such a way that guillotining the whole 
        printed stack into A5 sheets maintains the order when the two half stacks are combined.
        These are for solo races. Use <strong>Print Pre-Entry Pairs Entry Forms</strong> for pairs races.</p>
    <p>The blank entry forms and the pre-filled ones have identical format and comply with FRA guidelines for both senior and junior races.</p>    
    <p>Use <strong>Print Helpers List</strong> to print a form intended to be given to the RO to record the names and roles of helpers. 
        They can be later registered as helpers for the race and thereby acknowledged in the results.</p>    
    <p>The <strong>Finish Sheets</strong> report is intended to be given to finish funnel marshals to record bib numbers as entrants cross the finish line.
        This is not necessary if dibber timing is being used but is useful as a backup (should SI Timing fail).
        The senior and junior sheets are identical, just a different number of pages created to cover the entry limits.</p>
    <p>The <strong>Number Matrix</strong> report is intended to be given to an on-course marshalls to check off runners as they pass a CP. 
        Bib numbers are always allocated sequentially, so this makes it easy to check for missing runners.</p>
    <p>The <strong>Print Bibs</strong> button allows you to print two A5 landscape numbers per A4 sheet, for use when the RO forgets to get bibs.</p>
  `,
  'view-entries': `
    <p>Add competitors as they register on race day. 
        Bib and dibber numbers are assigned automatically starting from the <strong>first bib number</strong> and <strong>first dibber number</strong>
        as set in Event Settings. Dibbers are only assigned if dibbers are being used for the course. 
        The course (Seniors or Juniors) is auto assigned according to the entrant category. The category is auto calculated from gender and date of birth.</p>
    <p>The form is designed to be used with a keyboard for very fast entry, typing a pre-entry number will auto-fill the rest of the form, 
        typing a name that has been seen before will do the same, then just pressing return (or enter) will add the entry. 
        The form will auto reset for the next entry.</p>
    <p>Use <strong>Export to SI</strong> to create a CSV file in a format that can be imported into SI Timing. This is only relevant when using dibber timing.</p>
    <p><strong>Clear All</strong> removes every entry and should only be used to start over.</p>
    <p>If you have enabled pairs in the event settings, this form will show a <strong>Type</strong> field that is either <strong>- Solo</strong> or <strong>= Pair</strong>.
        Typing '-' or '=' will change the selection.</p>
    <p>In all cases, when starting a new entry, typing a number or a name will do the appropriate thing, no need to tab to a specific field.</p>
  `,
  'view-helpers': `
    <p>Record officials, marshals and volunteers. Helpers can appear in the results report as an acknowledgement of their contribution to the event.</p>
    <p>As with entries, typing a name that has been seen before will autofill the rest of the form.</p>
    <p>Assign a <strong>role</strong> to each helper (e.g. Timekeeper, Marshal) so the report shows who did what. Roles are managed on the Roles page.</p>
  `,
  'view-finishers': `
    <p>When timing is via a stopwatch, record finishing positions and times. This is done in two stages: first record bib numbers in finishing order, 
        then in a subsequent pass assign their finishing times. The <strong>mode</strong> field determines which stage is being recorded.
        In <strong>Bibs</strong> mode fill the <strong>Race / Bib No.</strong> field and press return. 
        That bib is then recorded along with its clock split number (which auto increments), the form then resets ready for the next bib number.
        In <strong>Time</strong> mode enter the time the entrant (or pair) crossed the finish line. 
        In this mode, on pressing return, the form auto moves to the next record that has not got a time.</p>
    <p>In <strong>Bibs</strong> mode there are special codes that can be entered in the <strong>Race / Bib No.</strong> field.
        Click on the <strong>Race/Bib No.</strong> field to see the list along with a brief description of each.</p> 
    <p>One particular special code is always present as Bib No. 0 - <strong>Clock</strong>: This specifes the time reference for all other times.
        If a stopwatch is being used in a conventional way the time associated with this record is 0. 
        If the stopwatch was started late (after runners had already started) the time specifies how late (up to an hour).
        If the stopwatch is being used in <strong>time-of-day</strong> mode the time specifies the time of day the stopwatch was started. 
        All later times are then interpreted as time-of-day rather than split times.</p>    
    <p><div>
        This form, like entries, is very keyboard-centric.
        In particular, when <strong>entering a time</strong>, it can be done by:
        <ul style="margin-left:2em">
            <li>entering 3 numbers: hours and minutes and seconds with anything in between (space is easiest),</li>
            <li>or by 2 numbers: minutes then seconds, in this case the hours is inherited from the previous time,</li> 
            <li>or by 1 number: seconds, in this case the hours and minutes are inherited from the previous time.</li>
        </ul>
    </div></p>
    <p>If an entrant started early or late, record their individual start time by entering their BIb No and 
        checking the <strong>This is a start event</strong> option before pressing return. 
        This adds a special record where its time will be interpreted as the time the entrant actually started. 
        A subsequent finish record is also required, their elapsed time is then calculated as the difference.</p>
     <p>An entrant can also be marked as <strong>DNF</strong> (did not finish) by entering their Bib No and 
        checking the <strong>This is a retiree</strong> option before pressing return. 
        This adds a special record that indicates the entrant has finished but is excluded from the results (except as a DNF).
        These records do not get a split number.</p>
  `,
  'view-safety': `
    <p>In the <strong>Outstanding</strong> tab, shows all entrants who have <strong>not yet been recorded as finishers or retired</strong>. 
        Use this at the end of the race to confirm that everyone is accounted for.</p>
    <p>When the list is empty, all entrants have either finished or been marked as DNF. Use the other tabs to get more specific lists.</p>
  `,
  'view-si-results': `
    <p>Import finish times from an SI Timing (processable) results export. The import matches competitors by bib number. 
        Unmatched records and other errors can be seen in the <strong>Issues</strong> tab.</p>
    <p>Run this <strong>before</strong> to populate the <strong>Results & Prize List</strong> page. 
        You can re-import if more data arrives later.</p>
  `,
  'view-results': `
    <p>Results, prizes and helpers are calculated automatically when you open this page.
        Switch between the <strong>Seniors</strong>, <strong>Juniors</strong>, <strong>Pairs</strong>, 
        <strong>Prizes</strong> and <strong>Helpers</strong> tabs to review the output.</p>
    <p>Use <strong>Export CSV</strong> to save a results spreadsheet for publication, 
        or <strong>Print Prize List</strong> to print overall and category winners for the presentation.</p>
    <p>Use <strong>Publish Results</strong> to publish results as one or more HTML pages that can be linked to from your website.
        The URL generated can be copied to the clipboard and pasted into a browser for direct viewing. 
        Use the <strong>Show Published URL</strong> button to be re-shown the last URL published.</p>
  `,
  'view-people': `
    <p>The master database of competitors. Records here can be persisted between events so names, 
        clubs and other relevant information accumulate to facilitate auto-complete during entry registration. 
        You can search, add and edit people directly on this page.</p>
    <p>People are also added automatically when a new name is entered during race-day registration.</p>
    <p>Use <strong>Find Duplicates</strong> to identify likely duplicated records and merge them.</p>
    <p>Use <strong>Merge...</strong> to merge people from another dataset into the list here.</p>
  `,
  'view-clubs': `
    <p>The master list of clubs used for auto-complete during entry. 
        Clubs are extracted from the people list, you can also manage them here.</p>
  `,
  'view-dibbers': `
    <p>Records the dibbers available for allocation during race-day registration.
        The short-code is used during registration and mapped to its corresponding long code when exporting entries to SI Timing.</p>
    <p>If the <strong>Lost</strong> column has a date, it indicates the dibber is no longer available and will not be allocated.</p>
    <p>Use <strong>Import CSV</strong> to import a dibber list, new short codes are added, existing ones are updated. 
        The CSV must include at least columns of "Short Code" and "Long Code".</p>
  `,
  'view-categories': `
    <p>The <strong>FRA</strong> (5-year age groups) and <strong>WFRA</strong> (10-year age groups)
        tabs show the built-in schemes (read-only). Select either scheme in Event Settings to use it.</p>
    <p>Use the <strong>Custom</strong> tab to define your own categories — load a preset as a starting
        point, then edit freely. Select <em>Custom</em> in Event Settings to activate your custom list.</p>
  `,
  'view-roles': `
    <p>The list of helper roles (e.g. Timekeeper, Start Marshal, Registration).
        Assign roles when recording helpers on the Helpers page so the helpers report shows who did what.</p>
    <p>Add roles here before recording helpers, or type them directly into the helpers form, or load the <strong>Built-in</strong> roles.</p>
  `,
  'view-datafile': `
    <p>Datasets are stored on the RaceMaster server. Sign in to view, create, and connect to your datasets.
        Each dataset holds all the data for one event — entries, finishers, results, and so on.</p>
    <p><strong>Connect</strong> — load a dataset from the server and make it the active dataset.
        Any unsaved local changes can be pushed first or discarded.</p>
    <p><strong>Save As</strong> — copy the current in-memory data to a new server dataset (useful for keeping history of each event).</p>
    <p><strong>Copy</strong> — duplicate an existing server dataset under a new name, without changing which one is connected.</p>
    <p><strong>Export / Import</strong> — save or restore a local JSON snapshot of all event data, independent of the server.</p>
    <p>Private datasets are only visible to their owner (and admins). Public datasets are visible to all signed-in users.</p>
    <p>When not signed-in you will see a login panel, either sign-in to your existing account or 
        create a new one (they are completely free with no-catches).
        If you do not want to use an account just select <strong>Continue without signing in</strong>.
        In that case you can you use the Export/Import buttons to work purely locally.</p>
  `,
};

export const PAGES = {
  about: `
    <p>RaceMaster is an offline-first web application for managing fell running race day operations.
       Once loaded it works without an internet connection and syncs automatically when the server is reachable.</p>
    <h3>Features</h3>
    <ul>
      <li><strong>Pre-entries</strong> — import from SportIdent / EntryCentral CSV, print pre-filled entry forms</li>
      <li><strong>Registration</strong> — on-the-day entry with automatic bib and SI card (dibber) assignment</li>
      <li><strong>Finishers</strong> — stopwatch time entry or SI dibber result import</li>
      <li><strong>Results</strong> — automatic category placing and prize list, CSV export, web publish</li>
      <li><strong>Safety</strong> — live outstanding / DNF / finished counts; no-show pre-entry list</li>
      <li><strong>Helpers</strong> — record volunteer names, roles, and contribution history</li>
      <li><strong>People database</strong> — persistent runner history across events</li>
      <li><strong>Paperwork</strong> — printable entry forms, finish sheets, number matrix, and A5 race bibs</li>
      <li><strong>Multi-device</strong> — conflict detection when two sessions edit the same dataset simultaneously</li>
    </ul>
    <h3>Data storage</h3>
    <p>All data is held in JSON files on the local server and cached in the browser.
       Use <em>Datasets</em> to back up, restore, or switch between events.</p>
    <h3>Feedback &amp; issues</h3>
    <p>Report problems or suggestions to the race organiser for the event.</p>
  `,

  'whats-new': `
    <h3>v0.0.4-alpha - current version</h3>
    <ul>
      <li>Add a custom categories facility, with import/export capabilities</li>
      <li>Add multi-role assignment to helpers</li>
    </ul>
    <h3>v0.0.3-alpha/h3>
    <ul>
      <li>Add consolidated results publishing with search and sort capabilities</li>
    </ul>
    <h3>v0.0.2-alpha</h3>
    <ul>
      <li>Add pairs capability</li>
      <li>UI improvements</li>
    </ul>
    <h3>v0.0.1-alpha</h3>
    <ul>
      <li><strong>About / What's New</strong> — this page and the ? button in the header</li>
      <li><strong>Optimistic locking</strong> — version counter detects simultaneous edits; header shows version and dirty indicator</li>
      <li><strong>Safety: No-shows tab</strong> — lists pre-entries that never checked in; highlights where a same-name on-day entry exists without a pre-entry link</li>
      <li><strong>Logic / view separation</strong> — pure data functions moved to <code>js/*.js</code> files, enabling unit testing without DOM</li>
      <li><strong>Server log rotation</strong> — persistent <code>server.log</code> with automatic rotation up to <code>server.log.9</code></li>
      <li><strong>Results publishing</strong> — publish results to a public web page directly from the app</li>
      <li><strong>Schema factories</strong> — <code>createEvent()</code>, <code>createPerson()</code> etc. as single source of truth for data shapes</li>
      <li><strong>CSV alias fallback</strong> — import columns map by alias; unknown columns fall back to the field name</li>
      <li><strong>Race bibs</strong> — SVG A5 bibs printed 2-up on A4, guillotine-sorted for easy stacking</li>
    </ul>
  `,
};

export const TABLES = {
  entries: [
    { id: 'bib',     label: 'Bib',     title: 'Race number' },
    { id: 'name',    label: 'Name',    title: "Competitor's name" },
    { id: 'club',    label: 'Club',    title: 'Running club' },
    { id: 'dob',     label: 'DoB',     title: 'Date of birth' },
    { id: 'cat',     label: 'Cat',     title: 'Age category' },
    { id: 'course',  label: 'Course',  title: 'Senior or junior course' },
    { id: 'dibber',  label: 'Dibber',  title: 'SportIdent card short number' },
    { id: 'pre_no',  label: 'Pre-No',  title: 'Pre-entry reference number' },
    { id: 'actions', label: 'Actions', title: 'Edit or delete this entry' },
  ],
  helpers: [
    { id: 'number',  label: '#',       title: 'Helper number' },
    { id: 'name',    label: 'Name',    title: "Helper's name" },
    { id: 'club',    label: 'Club',    title: 'Running club' },
    { id: 'role',    label: 'Role',    title: "Helper's role" },
    { id: 'actions', label: 'Actions', title: 'Edit or delete' },
  ],
  'pre-entries': [
    { id: 'ref',           label: 'Ref',           title: 'Pre-entry reference number' },
    { id: 'name',          label: 'Name',          title: "Competitor's name" },
    { id: 'gender',        label: 'G',             title: 'Gender' },
    { id: 'dob',           label: 'DoB',           title: 'Date of birth' },
    { id: 'club',          label: 'Club',          title: 'Running club' },
    { id: 'cat',           label: 'Cat',           title: 'Age category' },
    { id: 'fra',           label: 'FRA#',          title: 'FRA registration number' },
    { id: 'si_id',         label: 'SI ID',         title: 'SportIdent member number' },
    { id: 'eligibility',   label: 'Eligibility',   title: 'Race eligibility notes' },
    { id: 'email',         label: 'Email',         title: 'Email address' },
    { id: 'addr1',         label: 'Address 1',     title: 'Address line 1' },
    { id: 'addr2',         label: 'Address 2',     title: 'Address line 2' },
    { id: 'town',          label: 'Town',          title: 'Town' },
    { id: 'county',        label: 'County',        title: 'County' },
    { id: 'postcode',      label: 'Postcode',      title: 'Postcode' },
    { id: 'country',       label: 'Country',       title: 'Country' },
    { id: 'telephone',     label: 'Telephone',     title: 'Telephone number' },
    { id: 'mobile',        label: 'Mobile',        title: 'Mobile number' },
    { id: 'emerg_contact', label: 'Emerg. Contact', title: 'Emergency contact name' },
    { id: 'emerg_tel',     label: 'Emerg. Tel',    title: 'Emergency contact telephone' },
    { id: 'medical',       label: 'Medical',       title: 'Medical information' },
    { id: 'car_reg',       label: 'Car Reg',       title: 'Car registration' },
  ],
  finishers: [
    { id: 'line',    label: 'Line',    title: 'Stopwatch split number' },
    { id: 'event',   label: 'Event',   title: 'Type of event (Finish, Start, Retire)' },
    { id: 'clock',   label: 'Clock',   title: 'Recorded time' },
    { id: 'bib',     label: 'Bib',     title: 'Race number' },
    { id: 'name',    label: 'Name',    title: "Competitor's name" },
    { id: 'cat',     label: 'Cat',     title: 'Age category' },
    { id: 'course',  label: 'Course',  title: 'Senior or junior course' },
    { id: 'actions', label: 'Actions', title: 'Edit or delete' },
  ],
  'safety-outstanding': [
    { id: 'bib',     label: 'Bib',     title: 'Race number' },
    { id: 'name',    label: 'Name',    title: "Competitor's name" },
    { id: 'course',  label: 'Course',  title: 'Senior or junior course' },
    { id: 'cat',     label: 'Cat',     title: 'Age category' },
    { id: 'actions', label: 'Actions', title: 'Mark as DNF or take action' },
  ],
  'safety-dnf': [
    { id: 'bib',     label: 'Bib',     title: 'Race number' },
    { id: 'name',    label: 'Name',    title: "Competitor's name" },
    { id: 'course',  label: 'Course',  title: 'Senior or junior course' },
    { id: 'cat',     label: 'Cat',     title: 'Age category' },
    { id: 'actions', label: 'Actions', title: 'Edit or delete' },
  ],
  'safety-finished': [
    { id: 'bib',    label: 'Bib',    title: 'Race number' },
    { id: 'name',   label: 'Name',   title: "Competitor's name" },
    { id: 'course', label: 'Course', title: 'Senior or junior course' },
    { id: 'cat',    label: 'Cat',    title: 'Age category' },
    { id: 'line',   label: 'Line',   title: 'Finishing split line number in the finishers list' },
    { id: 'time',   label: 'Time',   title: 'Finish time' },
  ],
  'safety-early': [
    { id: 'bib',        label: 'Bib',        title: 'Race number' },
    { id: 'name',       label: 'Name',       title: "Competitor's name" },
    { id: 'course',     label: 'Course',     title: 'Senior or junior course' },
    { id: 'cat',        label: 'Cat',        title: 'Age category' },
    { id: 'start_time', label: 'Start Time', title: 'Individual start time recorded for this competitor' },
  ],
  'safety-noshows': [
    { id: 'name',       label: 'Name',        title: 'Pre-entry name' },
    { id: 'dob',        label: 'DOB',         title: 'Date of birth from pre-entry' },
    { id: 'club',       label: 'Club',        title: "Competitor's club" },
    { id: 'cat',        label: 'Cat',         title: 'Age category from pre-entry' },
    { id: 'pre_no',     label: 'Pre-entry #', title: 'SI Entries participant number' },
    { id: 'on_day_bib', label: 'On-day bib',  title: 'Bib assigned if they entered on the day without linking to their pre-entry' },
  ],
  'results-senior': [
    { id: 'pos',      label: 'Pos',     title: 'Overall finishing position' },
    { id: 'bib',      label: 'Bib',     title: 'Race number' },
    { id: 'in_cat',   label: 'In Cat',  title: 'Position within age category' },
    { id: 'name',     label: 'Name',    title: "Competitor's name" },
    { id: 'club',     label: 'Club',    title: 'Running club' },
    { id: 'cat',      label: 'Cat',     title: 'Age category' },
    { id: 'time',     label: 'Time',    title: 'Finish time (R = course record)' },
    { id: 'pct_ldrs', label: '%Ldrs',   title: "Finish time as a percentage of the winner's time", align: 'right' },
    { id: 'behind',   label: 'Behind',  title: 'Time behind the leader' },
  ],
  'results-junior': [
    { id: 'bib',    label: 'Bib',    title: 'Race number' },
    { id: 'in_cat', label: 'In Cat', title: 'Position within age category' },
    { id: 'name',   label: 'Name',   title: "Competitor's name" },
    { id: 'club',   label: 'Club',   title: 'Running club' },
    { id: 'cat',    label: 'Cat',    title: 'Age category' },
    { id: 'time',   label: 'Time',   title: 'Finish time' },
  ],
  prizes: [
    { id: 'pos',    label: 'Pos',    title: 'Overall finishing position' },
    { id: 'cat',    label: 'Cat',    title: 'Age category' },
    { id: 'in_cat', label: 'In Cat', title: 'Position within age category' },
    { id: 'time',   label: 'Time',   title: 'Finish time (R = course record, J = junior)' },
    { id: 'name',   label: 'Name',   title: 'Competitor\'s name (* = winner in multiple categories)' },
  ],
  'results-helpers': [
    { id: 'role',       label: 'Role',       title: "Helper's role" },
    { id: 'name',       label: 'Name',       title: "Helper's name" },
    { id: 'club',       label: 'Club',       title: 'Running club' },
    { id: 'cat',        label: 'Cat',        title: 'Age category' },
    { id: 'last_raced', label: 'Last Raced', title: 'Date this person last competed in a race' },
  ],
  'results-pairs': [
    { id: 'pos',     label: 'Pos',      title: 'Overall finish position' },
    { id: 'bib',     label: 'Bib',      title: 'Race bib number' },
    { id: 'in_cat',  label: 'In Cat',   title: 'Position within pair category (Male/Female/Mixed, Junior/Senior)' },
    { id: 'person1', label: 'Person 1', title: 'First competitor' },
    { id: 'person2', label: 'Person 2', title: 'Second competitor' },
    { id: 'club',    label: 'Club',     title: 'Club(s)' },
    { id: 'cat',     label: 'Cat',      title: 'Pair category and gender' },
    { id: 'time',    label: 'Time',     title: 'Finish time' },
  ],
  people: [
    { id: 'name',         label: 'Name',         title: "Person's name" },
    { id: 'gender',       label: 'G',            title: 'Gender' },
    { id: 'dob',          label: 'DoB',          title: 'Date of birth' },
    { id: 'club',         label: 'Club',         title: 'Running club' },
    { id: 'fra',          label: 'FRA',          title: 'FRA registration number' },
    { id: 'last_seen',    label: 'Last Seen',    title: 'Date last registered in a race' },
    { id: 'seen',         label: 'Seen',         title: 'Number of times raced' },
    { id: 'last_helped',  label: 'Last Helped',  title: 'Date last recorded as a helper' },
    { id: 'helped',       label: 'Helped',       title: 'Number of times helped at events' },
    { id: 'banned_until', label: 'Banned Until', title: 'Banned from competition until this date' },
    { id: 'actions',      label: 'Actions',      title: 'Edit or delete' },
  ],
  clubs: [
    { id: 'select',    label: 'S',         title: 'Select for merge' },
    { id: 'name',      label: 'Name',      title: 'Club name' },
    { id: 'people',    label: 'People',    title: 'Number of people from this club' },
    { id: 'last_seen', label: 'Last Seen', title: 'Most recent race date for any club member' },
  ],
  roles: [
    { id: 'role',        label: 'Role',        title: 'Role name (e.g. Timekeeper, Marshal)' },
    { id: 'description', label: 'Description', title: 'Description of what this role involves' },
    { id: 'actions',     label: 'Actions',     title: 'Edit or delete' },
  ],
  categories: [
    { id: 'minAge',    label: 'MinAge',     title: 'Minimum age for this category' },
    { id: 'maleCat',   label: 'Male Cat',   title: 'Male category code (e.g. MSEN, M40)' },
    { id: 'femaleCat', label: 'Female Cat', title: 'Female category code (e.g. WSEN, W40)' },
    { id: 'ref',       label: 'Ref',        title: 'Age reference: EOY = end of race year, NOW = actual age on race date' },
    { id: 'maxDist',   label: 'MaxDist',    title: 'Maximum race distance (km) allowed for this category' },
    { id: 'actions',   label: 'Actions',    title: 'Edit or delete' },
  ],
  dibbers: [
    { id: 'short_code', label: 'Short Code', title: 'Short (3-digit) SI card number' },
    { id: 'long_code',  label: 'Long Code',  title: 'Full SI card number' },
    { id: 'owner',      label: 'Owner',      title: 'Who owns this card' },
    { id: 'lost',       label: 'Lost',       title: 'Date this dibber was lost — lost dibbers are excluded from allocation' },
    { id: 'notes',      label: 'Notes',      title: 'Additional notes' },
    { id: 'actions',    label: 'Actions',    title: 'Edit or delete' },
  ],
};

export const GENDER = {
  FEMALE: 'Female',
  MALE:   'Male',
};

export const COURSE = {
  JUNIORS: 'Juniors',
  SENIORS: 'Seniors',
};
