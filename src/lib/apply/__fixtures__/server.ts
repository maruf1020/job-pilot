import http from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * Local fake application sites for tests (never real employers):
 *   /gh/jobs/1          Greenhouse-like single page (react-select style comboboxes, hidden file input, async location)
 *   /post/2 -> /ashby/2  posting with an Apply link, then an Ashby-like form (yes/no buttons, radios, checkbox group)
 *   /wiz/1, /wiz/2, /wiz/3  three-step wizard with Next, Review and Submit
 *   /workable/j/1/apply/  Workable-like form (ARIA radios, read-only select dropdowns, checkbox group)
 *   /captcha            a visible CAPTCHA challenge
 *   /turnstile/pass, /turnstile/stuck  a Turnstile-like widget whose token arrives after 1.5 s, or never
 * Every POST is recorded in `submissions` (raw body text) and answered with a thank-you page.
 */

const COMBO_SCRIPT = `
<script>
document.querySelectorAll('[data-combo]').forEach(function (wrap) {
  var input = wrap.querySelector('input[role=combobox]');
  var hidden = wrap.querySelector('input[type=hidden]');
  var shown = wrap.querySelector('.select__single-value');
  var menu = wrap.querySelector('.menu');
  var all = JSON.parse(wrap.getAttribute('data-options'));
  var asyncMode = wrap.hasAttribute('data-async');
  function render(q) {
    menu.innerHTML = '';
    var list = all.filter(function (o) { return !q || o.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    if (asyncMode && !q) list = [];
    list.forEach(function (o) {
      var d = document.createElement('div');
      d.setAttribute('role', 'option');
      d.className = 'select__option';
      d.textContent = o;
      d.addEventListener('mousedown', function (e) { e.preventDefault(); });
      d.addEventListener('click', function () { hidden.value = o; shown.textContent = o; input.value = ''; menu.hidden = true; input.setAttribute('aria-expanded', 'false'); });
      menu.appendChild(d);
    });
    menu.hidden = list.length === 0;
  }
  input.addEventListener('focus', function () { render(input.value); });
  input.addEventListener('click', function () { render(input.value); });
  input.addEventListener('input', function () { render(input.value); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { menu.hidden = true; } });
  input.addEventListener('blur', function () { setTimeout(function () { menu.hidden = true; }, 150); });
});
</script>`

function combo(id: string, label: string, options: string[], opts: { required?: boolean; async?: boolean } = {}) {
  return `<div class="select" data-combo ${opts.async ? 'data-async' : ''} data-options='${JSON.stringify(options).replace(/'/g, '&#39;')}'>
    <label id="${id}-label" for="${id}">${label}${opts.required ? '<span aria-hidden="true">*</span>' : ''}</label>
    <div class="select__control"><div class="select__value-container"><span class="select__single-value"></span>
      <div class="select__input-container"><input id="${id}" class="select__input" role="combobox" aria-autocomplete="list" aria-labelledby="${id}-label" ${opts.required ? 'aria-required="true"' : ''} autocomplete="off"></div></div>
      <input type="hidden" name="${id}">
    </div>
    <div class="menu" hidden></div>
  </div>`
}

const page = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:sans-serif;max-width:760px;margin:20px auto} div{margin:8px 0} .menu{border:1px solid #ccc} .menu [role=option]{padding:4px;cursor:pointer}</style>
</head><body>${body}</body></html>`

const GH = page(
  'Senior Software Engineer - Acme',
  `<h1>Senior Software Engineer</h1>
  <p>Acme builds payments software in Dublin. You will work with TypeScript, React and Node.js.</p>
  <h2>Apply for this job</h2>
  <form id="application-form" action="/submit/gh" method="post" enctype="multipart/form-data">
    <div><label for="first_name">First Name<span aria-hidden="true">*</span></label><input id="first_name" name="first_name" aria-required="true" type="text"></div>
    <div><label for="last_name">Last Name<span aria-hidden="true">*</span></label><input id="last_name" name="last_name" aria-required="true" type="text"></div>
    <div><label for="email">Email<span aria-hidden="true">*</span></label><input id="email" name="email" type="email" required></div>
    <div><label for="phone">Phone</label><input id="phone" name="phone" type="tel"></div>
    <div><div class="label" id="upload-label-resume">Resume/CV<span>*</span></div><input id="resume" name="resume" type="file" aria-labelledby="upload-label-resume" required style="position:absolute;left:-9999px"><button type="button" onclick="document.getElementById('resume').click()">Attach</button></div>
    <div><label for="cover_letter">Cover Letter</label><input id="cover_letter" name="cover_letter" type="file"></div>
    <div><label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="linkedin" type="text"></div>
    <div><label for="twitter">Twitter</label><input id="twitter" name="twitter" type="text"></div>
    ${combo('q_sponsor', 'Will you now or in the future require visa sponsorship to work in Ireland?', ['Yes', 'No'], { required: true })}
    ${combo('q_location', 'Location (City)', ['Lagos, Faro, Portugal', 'Lagos, Lagos State, Nigeria', 'Dakar, Senegal', 'Dublin, Ireland'], { required: true, async: true })}
    ${combo('q_heard', 'How did you hear about this job?', ['LinkedIn', 'Job board', 'Referral', 'Other'])}
    <div><label for="years">How many years of professional experience do you have?<span>*</span></label><select id="years" name="years" required><option value="">Please select</option><option>0-2 years</option><option>3-5 years</option><option>5-7 years</option><option>8+ years</option></select></div>
    <div><label for="why">Why do you want to work at Acme?<span>*</span></label><textarea id="why" name="why" required></textarea></div>
    <h3>Voluntary Self-Identification</h3>
    <div><label for="gender">Gender</label><select id="gender" name="gender"><option value="">Select...</option><option>Male</option><option>Female</option><option value="decline">Decline To Self Identify</option></select></div>
    <div><input type="checkbox" id="consent" name="consent" required><label for="consent">I agree to the processing of my personal data according to the privacy policy</label></div>
    <div><input type="checkbox" id="news" name="news"><label for="news">Send me the Acme newsletter</label></div>
    <button type="submit">Submit application</button>
  </form>
  ${COMBO_SCRIPT}`,
)

const POSTING = page(
  'Backend Engineer at Beta',
  `<nav><a href="/">Home</a> <a href="/jobs">All jobs</a> <a href="https://www.linkedin.com/company/beta">Follow us on LinkedIn</a></nav>
  <h1>Backend Engineer</h1><p>Beta is hiring a Node.js engineer in Amsterdam.</p>
  <a href="/ashby/2/application" class="btn">Apply for this job</a>`,
)

const ASHBY = page(
  'Application - Backend Engineer',
  `<h1>Backend Engineer</h1>
  <form action="/submit/ashby" method="post" enctype="multipart/form-data">
    <div class="field"><label for="_systemfield_name">Name<span>*</span></label><input id="_systemfield_name" name="_systemfield_name" required></div>
    <div class="field"><label for="_systemfield_email">Email<span>*</span></label><input id="_systemfield_email" name="_systemfield_email" type="email" required></div>
    <div class="field"><label for="_systemfield_resume">Resume<span>*</span></label><input id="_systemfield_resume" name="_systemfield_resume" type="file" required></div>
    <div class="field"><label class="question">Are you willing to relocate to Amsterdam?<span>*</span></label>
      <div class="_yesno"><button onclick="event.preventDefault();this.parentNode.querySelectorAll('button').forEach(function(b){b.classList.remove('active')});this.classList.add('active');document.getElementById('relocate').value=this.textContent">Yes</button><button onclick="event.preventDefault();this.parentNode.querySelectorAll('button').forEach(function(b){b.classList.remove('active')});this.classList.add('active');document.getElementById('relocate').value=this.textContent">No</button><input type="checkbox" tabindex="-1" name="relocate-box" style="display:none"></div>
      <input type="hidden" id="relocate" name="relocate"></div>
    <fieldset><legend>Preferred work arrangement<span>*</span></legend>
      <label><input type="radio" name="arrangement" value="remote" required> Remote</label>
      <label><input type="radio" name="arrangement" value="hybrid"> Hybrid</label>
      <label><input type="radio" name="arrangement" value="onsite"> On-site</label></fieldset>
    <fieldset><legend>Which of these have you used in production?</legend>
      <label><input type="checkbox" name="stack" value="node"> Node.js</label>
      <label><input type="checkbox" name="stack" value="go"> Go</label>
      <label><input type="checkbox" name="stack" value="postgres"> PostgreSQL</label></fieldset>
    <button type="submit" class="ashby-application-form-submit-button">Submit Application</button>
  </form>`,
)

const WIZ1 = page(
  'Apply - Step 1',
  `<h2>My Information</h2><form action="/wiz/2" method="get">
   <div><label for="fn">Legal first name*</label><input id="fn" name="fn" required></div>
   <div><label for="ln">Legal last name*</label><input id="ln" name="ln" required></div>
   <div><label for="em">Email address*</label><input id="em" name="em" type="email" required></div>
   <div><label for="cv">Upload your CV*</label><input id="cv" name="cv" type="file" required></div>
   <button type="submit">Next</button></form>`,
)
const WIZ2 = page(
  'Apply - Step 2',
  `<h2>Questions</h2><form action="/wiz/3" method="get">
   <div><label for="notice">What is your notice period?*</label><input id="notice" name="notice" required></div>
   <div><label for="auth">Are you legally authorized to work in the Netherlands?*</label><select id="auth" name="auth" required><option value="">Select one</option><option>Yes</option><option>No</option></select></div>
   <button type="button" onclick="history.back()">Back</button> <button type="submit">Save and continue</button></form>`,
)
const WIZ3 = page(
  'Apply - Review',
  `<h2>Review</h2><p>Please check your answers.</p><form action="/submit/wiz" method="post">
   <div><input type="checkbox" id="terms" name="terms" required><label for="terms">I confirm that the information is correct</label></div>
   <button type="submit">Submit</button></form>`,
)

// ---- Workable-like form (apply.workable.com) ---------------------------------------------
// Copies the real widget structure: the "*" sits in a span next to the aria-labelledby text,
// radios are div[role=radio] wrappers whose hidden native input never gets checked, selects are
// read-only inputs whose list ignores Escape and closes late when you press elsewhere, and
// "select all that apply" questions are separately named checkboxes in a role=group.

const wkHead = (id: string, label: string, required = true) =>
  `<span class="wk-head">${required ? '<span class="wk-star"><strong>*</strong></span>' : ''}<span><span id="${id}_label"><strong>${label}</strong></span></span></span>`

const wkText = (id: string, label: string, opts: { type?: string; maxLength?: number } = {}) =>
  `<div class="wk-field"><label>${wkHead(id, label)}<div data-role="illustrated-input"><div><input id="${id}" name="${id}" data-ui="${id}" aria-labelledby="${id}_label" required aria-required="true" type="${opts.type ?? 'text'}" ${opts.maxLength ? `maxlength="${opts.maxLength}"` : ''}></div></div></label></div>`

const wkRadio = (id: string, label: string) =>
  `<div class="wk-field"><div>${wkHead(id, label)}<div><fieldset role="radiogroup" data-ui="${id}" aria-labelledby="${id}_label">${['YES', 'NO']
    .map(
      (t, i) =>
        `<div data-ui="option" role="radio" aria-checked="false" aria-required="true" tabindex="${i ? -1 : 0}" id="wrapper_${id}_${i}" aria-labelledby="${id}_label radio_label_${id}_${i}"><label><input id="${id}_${i}" name="${id}" type="radio" value="${i ? 'false' : 'true'}" required aria-required="true" tabindex="-1" aria-hidden="true" class="wk-hidden-input"><div><div><span id="radio_label_${id}_${i}">${t}</span></div></div></label></div>`,
    )
    .join('')}</fieldset></div></div><input type="hidden" name="${id}"></div>`

const wkSelect = (id: string, label: string, options: string[]) =>
  `<div class="wk-field"><div>${wkHead(id, label)}<div data-ui="${id}" data-open="false" data-input-type="select" class="wk-select" data-options='${JSON.stringify(options).replace(/'/g, '&#39;')}'><label><div data-role="illustrated-input"><div><input id="input_${id}_input" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-owns="input_${id}_listbox" aria-controls="input_${id}_listbox" aria-autocomplete="list" autocomplete="off" aria-labelledby="${id}_label" placeholder="Select an option..." type="text" readonly value=""></div></div></label><input name="${id}" required tabindex="-1" aria-hidden="true" value="" class="wk-twin"></div></div></div>`

const wkChecks = (id: string, label: string, options: string[]) =>
  `<div class="wk-field"><div>${wkHead(id, label)}<div role="group" data-ui="${id}" aria-labelledby="${id}_label" id="input_${id}">${options
    .map(
      (o, i) =>
        `<label class="wk-check" aria-labelledby="${id}_label" data-checked="false"><div role="checkbox" aria-checked="false" aria-required="true" tabindex="0" id="${id}_${i}" aria-labelledby="${id}_label checkbox_label_${id}_${i}"><input aria-required="true" tabindex="-1" aria-hidden="true" type="checkbox" required name="${id}_${i}" class="wk-hidden-input"></div><span id="checkbox_label_${id}_${i}">${o}</span></label>`,
    )
    .join('')}</div></div></div>`

// Ashby checkbox group: the question is a <label> heading the fieldset (no <legend>), each box named after its option.
const ASHBY_GROUPS = page(
  'Application - Platform Engineer',
  `<form action="/submit/ashby-groups" method="post">
    <fieldset class="ashby-application-form-input-checkbox-group"><label class="ashby-application-form-question-title _required_x" for="q1">Are you already in Munich/ London / willing to relocate?</label>
      <div><span><input type="checkbox" id="q1-0" name="I live in London"></span><label for="q1-0">I live in London</label></div>
      <div><span><input type="checkbox" id="q1-1" name="I live in Munich"></span><label for="q1-1">I live in Munich</label></div>
      <div><span><input type="checkbox" id="q1-2" name="I would be willing to relocate to Munich"></span><label for="q1-2">I would be willing to relocate to Munich</label></div>
    </fieldset>
    <fieldset class="ashby-application-form-input-checkbox-group"><label class="ashby-application-form-question-title _required_x" for="q2">How many years of professional software development experience do you have?</label>
      <div><span><input type="checkbox" id="q2-0" name="Under 3 years"></span><label for="q2-0">Under 3 years</label></div>
      <div><span><input type="checkbox" id="q2-1" name="3-5 years"></span><label for="q2-1">3-5 years</label></div>
      <div><span><input type="checkbox" id="q2-2" name="5-10 years"></span><label for="q2-2">5-10 years</label></div>
      <div><span><input type="checkbox" id="q2-3" name="+10 years"></span><label for="q2-3">+10 years</label></div>
    </fieldset>
    <button type="submit">Submit Application</button>
  </form>`,
)

// LinkedIn-style Easy Apply: a modal form over a page that has its own search box and language picker.
const MODAL_APPLY = page(
  'Job page with Easy Apply modal',
  `<header><input type="text" aria-label="Search" placeholder="Search"><select aria-label="Select language"><option>English</option><option>Deutsch</option></select></header>
  <main><h1>Senior Software Engineer</h1><button>Easy Apply</button></main>
  <div role="dialog" aria-modal="true" aria-label="Apply to Acme">
    <h2>Apply to Acme</h2>
    <label for="m-email">Email address*</label><select id="m-email" required><option>sam.okafor@example.com</option></select>
    <label for="m-cc">Phone country code*</label><select id="m-cc" required><option>Nigeria (+234)</option><option>Ireland (+353)</option></select>
    <label for="m-phone">Mobile phone number*</label><input id="m-phone" type="text" required>
    <button>Next</button>
  </div>`,
)

const WORKABLE_SCRIPT = `
<script>
// Radios: the wrapper holds the state; the native input is never checked (like Workable's React state).
document.querySelectorAll('fieldset[role=radiogroup]').forEach(function (fs) {
  var mirror = fs.closest('.wk-field').querySelector('input[type=hidden]');
  fs.querySelectorAll('[role=radio]').forEach(function (opt) {
    opt.addEventListener('click', function () {
      fs.querySelectorAll('[role=radio]').forEach(function (o) { o.setAttribute('aria-checked', o === opt ? 'true' : 'false'); });
      mirror.value = opt.querySelector('input').value;
    });
    opt.querySelector('input').addEventListener('click', function (e) { e.preventDefault(); });
  });
});
// Checkboxes: native input, ARIA state follows it.
document.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
  cb.addEventListener('change', function () {
    cb.closest('[role=checkbox]').setAttribute('aria-checked', String(cb.checked));
    cb.closest('label').setAttribute('data-checked', String(cb.checked));
  });
});
// Selects: read-only input toggles a list; Escape does nothing; pressing elsewhere closes it 300ms later.
document.querySelectorAll('.wk-select').forEach(function (wrap) {
  var input = wrap.querySelector('input[role=combobox]');
  var twin = wrap.querySelector('input.wk-twin');
  var options = JSON.parse(wrap.getAttribute('data-options'));
  var list = null;
  function close() { if (list) { list.remove(); list = null; } input.setAttribute('aria-expanded', 'false'); wrap.setAttribute('data-open', 'false'); }
  function open() {
    list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    list.id = input.getAttribute('aria-controls');
    list.className = 'wk-list';
    options.forEach(function (o, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.id = list.id + '_' + i;
      li.innerHTML = '<div role="presentation"><div><span><span data-role="option-label"></span></span></div></div>';
      li.querySelector('[data-role=option-label]').textContent = o;
      li.addEventListener('click', function () { input.value = o; twin.value = o; close(); });
      list.appendChild(li);
    });
    wrap.appendChild(list);
    input.setAttribute('aria-expanded', 'true');
    wrap.setAttribute('data-open', 'true');
  }
  input.addEventListener('click', function () { if (list) close(); else open(); });
  document.addEventListener('mousedown', function (e) {
    if (!list || wrap.contains(e.target)) return;
    var l = list;
    setTimeout(function () { if (list === l) close(); }, 300);
  });
});
</script>`

const WORKABLE = page(
  'Java Software Engineer - Acme Bank',
  `<style>.wk-hidden-input{position:absolute;opacity:0;width:13px;height:13px;margin:0} [role=radio],[role=checkbox]{position:relative;display:inline-block;padding:6px 12px;border:1px solid #999;cursor:pointer} .wk-twin{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none} .wk-list{list-style:none;padding:0;border:1px solid #ccc} .wk-list li{padding:4px;cursor:pointer} .wk-check{display:block}</style>
  <h1>Java Software Engineer</h1>
  <form action="/submit/workable" method="post" enctype="multipart/form-data" novalidate>
    <section><h3>Personal information</h3>
      ${wkText('firstname', 'First name')}
      ${wkText('lastname', 'Last name')}
      ${wkText('email', 'Email', { type: 'email' })}
      <div class="wk-field">${wkHead('resume', 'Resume')}<input type="file" id="resume" name="resume" aria-labelledby="resume_label" required></div>
    </section>
    <section><h3>Details</h3>
      ${wkRadio('CA_1', 'Will you now, or in the future, require sponsorship to work in the UK?')}
      ${wkText('CA_2', 'Please confirm the current right to work document you hold, eg. British passport, settled status, ILR, Skilled Worker Visa (If visa, please confirm type and expiry):', { maxLength: 127 })}
      ${wkRadio('CA_3', 'Have you previously worked for Acme Group (either directly employed or as a contractor)?')}
      ${wkSelect('CA_4', 'Where did you hear about this role?', ['Acme Careers Page', 'LinkedIn', 'Referred by a Friend (Acme Employee)', 'Agency', 'Other'])}
      ${wkChecks('CA_5', 'Do you know anyone who works at (or is in the process of joining) Acme Group? (Please select all that apply)', [
        "No - I don't know anyone who works at or is joining Acme Group",
        'Yes - Family Member (including Cousin or In-Laws)',
        'Yes - Someone I live with',
        'Yes - Friend/(ex)Colleague/Other',
      ])}
      ${wkSelect('CA_6', 'Have you worked for KPMG LLP at any point within the past 2 years, as part of the audit engagement team for Acme Group?', ['Yes', 'No'])}
      ${wkRadio('CA_7', 'Do you have the right to work in the UK without requiring sponsorship?')}
    </section>
    <section><div data-ui="gdpr"><label class="wk-check" data-ui="gdpr" data-checked="false"><div role="checkbox" aria-checked="false" tabindex="0" id="gdpr_box" aria-labelledby="checkbox_label_gdpr"><input tabindex="-1" aria-hidden="true" type="checkbox" name="gdpr" class="wk-hidden-input"></div><span id="checkbox_label_gdpr"><span>I have read, understand and accept the content of the <a href="/privacy">Privacy Notice</a> and consent to the processing of my data as part of this application.</span></span></label></div></section>
    <button type="submit" data-ui="apply-button">Submit application</button>
  </form>
  ${WORKABLE_SCRIPT}`,
)

const CAPTCHA = page(
  'Verify',
  `<h1>Application</h1><form><div><label for="e">Email</label><input id="e" type="email"></div><div><label for="n">Name</label><input id="n"></div><div><label for="r">Resume</label><input id="r" type="file"></div></form>
   <iframe src="/recaptcha/api2/bframe?k=test" width="320" height="420" title="recaptcha challenge"></iframe>`,
)

/** Cloudflare-Turnstile-like widget under a form: the token arrives after `ms` (passes by itself), or never. */
const turnstile = (ms: number | null) =>
  page(
    'Turnstile',
    `<h1>Application</h1><form method="post" action="/turnstile/submit"><div><label for="e">Email</label><input id="e" name="email" type="email"></div>
     <div class="cf-turnstile" style="width:300px;height:65px;border:1px solid #ddd"><div></div><input type="hidden" name="cf-turnstile-response" id="cf-chl-widget_response"></div>
     <button type="submit">Submit application</button></form>
     ${ms === null ? '' : `<script>setTimeout(function(){ document.getElementById('cf-chl-widget_response').value = 'token-' + Date.now(); }, ${ms});</script>`}`,
  )

export interface FixtureServer {
  base: string
  submissions: Array<{ path: string; body: string }>
  close: () => Promise<void>
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const submissions: Array<{ path: string; body: string }> = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const send = (html: string, status = 200) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        submissions.push({ path: url.pathname, body: Buffer.concat(chunks).toString('latin1') })
        send(page('Thank you', '<h1>Thank you for applying!</h1><p>We have received your application.</p>'))
      })
      return
    }
    if (url.pathname === '/gh/jobs/1') return send(GH)
    if (url.pathname === '/post/2') return send(POSTING)
    if (url.pathname === '/ashby/2/application') return send(ASHBY)
    if (url.pathname === '/ashby/groups') return send(ASHBY_GROUPS)
    if (url.pathname === '/modal/apply') return send(MODAL_APPLY)
    if (url.pathname === '/wiz/1') return send(WIZ1)
    if (url.pathname === '/wiz/2') {
      submissions.push({ path: '/wiz/1', body: url.search })
      return send(WIZ2)
    }
    if (url.pathname === '/wiz/3') {
      submissions.push({ path: '/wiz/2', body: url.search })
      return send(WIZ3)
    }
    if (url.pathname === '/workable/j/1/apply/') return send(WORKABLE)
    if (url.pathname === '/captcha') return send(CAPTCHA)
    if (url.pathname === '/turnstile/pass') return send(turnstile(1500))
    if (url.pathname === '/turnstile/stuck') return send(turnstile(null))
    if (url.pathname.startsWith('/recaptcha/')) return send('<html><body style="background:#eee">challenge</body></html>')
    send(page('Not found', '<h1>404</h1>'), 404)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const port = (server.address() as AddressInfo).port
  return {
    base: `http://127.0.0.1:${port}`,
    submissions,
    close: () => new Promise((r) => server.close(() => r())),
  }
}
