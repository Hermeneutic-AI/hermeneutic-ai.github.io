/* Daily Reports viewer
 *
 * Lists the analytic markdown briefs published in a public GitHub repo and
 * renders the one you click in an on-site reader, so nobody is bounced out
 * to GitHub. Wired up by layouts/_default/embed.html when a page sets
 * `reports` in front matter; repo coordinates arrive as data- attributes
 * on .daily-reports.
 *
 * The directory listing comes from the GitHub contents API (one request,
 * session-cached); report bodies come from raw.githubusercontent.com. The
 * markdown renderer below escapes ALL HTML before applying its transforms,
 * so report content can never inject markup into the page.
 */
(function () {
  'use strict';

  var INITIAL_COUNT = 5;  // latest dailies shown on load
  var STEP = 10;          // revealed per "Show more"

  var section = document.querySelector('.daily-reports');
  if (!section || !window.fetch) return;

  var owner = section.getAttribute('data-owner');
  var repo = section.getAttribute('data-repo');
  var branch = section.getAttribute('data-branch') || 'main';
  var dir = section.getAttribute('data-path') || 'reports';

  var listEl = section.querySelector('.report-list');
  var statusEl = section.querySelector('.reports-status');
  var moreBtn = section.querySelector('.reports-more');

  var modal = document.querySelector('.report-modal');
  var panelBody = modal.querySelector('.report-modal-body');
  var titleEl = modal.querySelector('.report-modal-title');
  var sourceEl = modal.querySelector('.report-modal-source');
  var newerBtn = modal.querySelector('.report-nav-newer');
  var olderBtn = modal.querySelector('.report-nav-older');
  var closeBtn = modal.querySelector('.report-modal-close');

  var reports = [];    // newest first: { name, day ('YYYY-MM-DD') }
  var shown = 0;
  var openIndex = -1;
  var lastFocus = null;

  var archiveUrl = 'https://github.com/' + owner + '/' + repo +
                   '/tree/' + branch + '/' + dir;

  /* ---------- data ---------- */

  // Session-cache fetched text so reopening reports (and revisiting the
  // page within a tab session) doesn't re-hit GitHub's rate limits.
  function cachedText(url) {
    var key = 'daily-reports:' + url;
    try {
      var hit = sessionStorage.getItem(key);
      if (hit !== null) return Promise.resolve(hit);
    } catch (e) { /* storage unavailable — fetch every time */ }
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      try { sessionStorage.setItem(key, text); } catch (e) { /* quota */ }
      return text;
    });
  }

  var NAME_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4})_report\.md$/;

  function loadIndex() {
    var api = 'https://api.github.com/repos/' + owner + '/' + repo +
              '/contents/' + dir + '?ref=' + encodeURIComponent(branch);
    cachedText(api).then(function (text) {
      var byDay = {};
      JSON.parse(text).forEach(function (entry) {
        var m = typeof entry.name === 'string' && entry.name.match(NAME_RE);
        if (!m) return;
        // A day can have several runs; keep only its latest as the daily.
        if (!byDay[m[1]] || entry.name > byDay[m[1]].name) {
          byDay[m[1]] = { name: entry.name, day: m[1] };
        }
      });
      reports = Object.keys(byDay).sort().reverse().map(function (d) {
        return byDay[d];
      });
      if (!reports.length) throw new Error('no reports');
      statusEl.hidden = true;
      showMore(INITIAL_COUNT);
    }).catch(function () {
      statusEl.innerHTML = 'Couldn’t load the report list — ' +
        '<a href="' + archiveUrl + '" target="_blank" rel="noopener">' +
        'browse the archive on GitHub</a>.';
    });
  }

  function dateLabel(day) {
    return new Date(day + 'T12:00:00').toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function weekdayLabel(day) {
    return new Date(day + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long'
    });
  }

  /* ---------- list ---------- */

  function showMore(n) {
    var end = Math.min(shown + n, reports.length);
    for (var i = shown; i < end; i++) listEl.appendChild(rowFor(i));
    shown = end;
    var left = reports.length - shown;
    moreBtn.hidden = left <= 0;
    if (left > 0) {
      moreBtn.textContent = 'Show ' + Math.min(STEP, left) + ' more';
    }
  }

  function rowFor(i) {
    var r = reports[i];
    var li = document.createElement('li');
    li.className = 'report-item';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'report-link';
    var date = document.createElement('span');
    date.className = 'report-date';
    date.textContent = dateLabel(r.day);
    if (i === 0) {
      var badge = document.createElement('span');
      badge.className = 'status';
      badge.textContent = 'Latest';
      date.appendChild(badge);
    }
    var meta = document.createElement('span');
    meta.className = 'report-meta';
    meta.textContent = weekdayLabel(r.day);
    btn.appendChild(date);
    btn.appendChild(meta);
    btn.addEventListener('click', function () { openReport(i, btn); });
    li.appendChild(btn);
    return li;
  }

  /* ---------- modal reader ---------- */

  function openReport(i, trigger) {
    var r = reports[i];
    openIndex = i;
    if (trigger) lastFocus = trigger;
    titleEl.textContent = dateLabel(r.day);
    sourceEl.href = 'https://github.com/' + owner + '/' + repo + '/blob/' +
                    branch + '/' + dir + '/' + encodeURIComponent(r.name);
    panelBody.innerHTML = '<p class="report-note">Loading report…</p>';
    newerBtn.disabled = i <= 0;
    olderBtn.disabled = i >= reports.length - 1;
    modal.hidden = false;
    document.documentElement.classList.add('report-modal-open');
    closeBtn.focus();

    var raw = 'https://raw.githubusercontent.com/' + owner + '/' + repo +
              '/' + branch + '/' + dir + '/' + encodeURIComponent(r.name);
    cachedText(raw).then(function (md) {
      if (openIndex !== i) return; // reader already moved to another report
      var doc = splitTitle(md);
      if (doc.title) titleEl.textContent = doc.title;
      panelBody.innerHTML = renderMarkdown(doc.body);
      panelBody.scrollTop = 0;
    }).catch(function () {
      if (openIndex !== i) return;
      panelBody.innerHTML = '<p class="report-note">Couldn’t load this ' +
        'report — <a href="' + sourceEl.href + '" target="_blank" ' +
        'rel="noopener">read it on GitHub</a>.';
    });
  }

  function closeModal() {
    modal.hidden = true;
    openIndex = -1;
    document.documentElement.classList.remove('report-modal-open');
    if (lastFocus) lastFocus.focus();
  }

  // The brief's own H1 (e.g. "Intelligence Brief — July 05, 2026") becomes
  // the reader's title instead of repeating inside the body.
  function splitTitle(md) {
    var m = md.match(/^\s*#[ \t]+(.+)/);
    if (!m) return { title: '', body: md };
    return {
      title: m[1].replace(/\*\*|\*|`/g, '').trim(),
      body: md.slice(m.index + m[0].length)
    };
  }

  /* ---------- markdown rendering ----------
     Escape-first mini renderer covering what the generated briefs use:
     headings, hr, blockquotes, nested ul/ol, bold/italic, inline code,
     fenced code, links, and [[n]](url) citations (as superscripts). */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(text) {
    var out = escapeHtml(text);
    // Stash code spans so their contents skip the other transforms.
    var stash = [];
    out = out.replace(/`([^`]+)`/g, function (_, code) {
      stash.push('<code>' + code + '</code>');
      return '\u0000' + (stash.length - 1) + '\u0000';
    });
    // Numbered citations: [[12]](url) -> superscript source link.
    out = out.replace(/\[\[(\d+)\]\]\((https?:[^)\s]+)\)/g,
      '<sup class="report-cite"><a href="$2" target="_blank" rel="noopener">$1</a></sup>');
    // Regular links (http/https only); labels may contain one level of
    // brackets, e.g. article titles like "[Interview [FULL] - Fox 9](url)".
    out = out.replace(/\[((?:[^\[\]]|\[[^\]]*\])+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    out = out.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return stash[+i];
    });
    return out;
  }

  function renderMarkdown(md) {
    var lines = md.replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var para = [];
    var quote = [];
    var fence = null;        // accumulating lines of a ``` block, or null
    var listStack = [];      // open lists: { type: 'ul'|'ol', indent: n }

    function flushPara() {
      if (!para.length) return;
      html.push('<p>' + inline(para.join(' ')) + '</p>');
      para = [];
    }
    function flushQuote() {
      if (!quote.length) return;
      html.push('<blockquote><p>' + inline(quote.join(' ')) + '</p></blockquote>');
      quote = [];
    }
    function closeOneList() {
      var l = listStack.pop();
      html.push('</li></' + l.type + '>');
    }
    function closeAllLists() {
      while (listStack.length) closeOneList();
    }
    function flushBlocks() {
      flushPara();
      flushQuote();
      closeAllLists();
    }

    for (var n = 0; n < lines.length; n++) {
      var line = lines[n];

      if (fence !== null) {
        if (/^\s*```/.test(line)) {
          html.push('<pre><code>' + escapeHtml(fence.join('\n')) + '</code></pre>');
          fence = null;
        } else {
          fence.push(line);
        }
        continue;
      }
      if (/^\s*```/.test(line)) { flushBlocks(); fence = []; continue; }

      if (!line.trim()) { flushBlocks(); continue; }

      var m = line.match(/^(#{1,6})[ \t]+(.+)/);
      if (m) {
        flushBlocks();
        var level = m[1].length;
        html.push('<h' + level + '>' + inline(m[2].trim()) + '</h' + level + '>');
        continue;
      }

      if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushBlocks();
        html.push('<hr>');
        continue;
      }

      m = line.match(/^>[ \t]?(.*)$/);
      if (m) {
        flushPara();
        closeAllLists();
        quote.push(m[1]);
        continue;
      }

      m = line.match(/^([ \t]*)([-*+]|\d+\.)[ \t]+(.+)$/);
      if (m) {
        flushPara();
        flushQuote();
        var indent = m[1].replace(/\t/g, '  ').length;
        var type = /\d/.test(m[2]) ? 'ol' : 'ul';
        // Source appendices number items to match citation superscripts
        // (28., 31., 37. …), so keep the author's numbering.
        var liTag = type === 'ol'
          ? '<li value="' + parseInt(m[2], 10) + '">'
          : '<li>';
        while (listStack.length &&
               listStack[listStack.length - 1].indent > indent) {
          closeOneList();
        }
        var top = listStack[listStack.length - 1];
        if (top && top.indent === indent && top.type !== type) {
          closeOneList();
          top = listStack[listStack.length - 1];
        }
        if (top && top.indent === indent) {
          html.push('</li>' + liTag);
        } else {
          // Deeper (or first) level: the new list nests inside the still-
          // open <li> when one exists.
          html.push('<' + type + '>' + liTag);
          listStack.push({ type: type, indent: indent });
        }
        html.push(inline(m[3]));
        continue;
      }

      // Plain text: a continuation of the open list item, else paragraph.
      if (listStack.length) {
        html.push(' ' + inline(line.trim()));
      } else {
        flushQuote();
        para.push(line.trim());
      }
    }

    if (fence !== null) {
      html.push('<pre><code>' + escapeHtml(fence.join('\n')) + '</code></pre>');
    }
    flushBlocks();
    return html.join('\n');
  }

  /* ---------- wiring ---------- */

  moreBtn.addEventListener('click', function () { showMore(STEP); });
  closeBtn.addEventListener('click', closeModal);
  modal.querySelector('.report-modal-backdrop')
       .addEventListener('click', closeModal);
  newerBtn.addEventListener('click', function () {
    if (openIndex > 0) openReport(openIndex - 1);
  });
  olderBtn.addEventListener('click', function () {
    if (openIndex >= 0 && openIndex < reports.length - 1) {
      openReport(openIndex + 1);
    }
  });
  document.addEventListener('keydown', function (e) {
    if (modal.hidden) return;
    if (e.key === 'Escape') closeModal();
    else if (e.key === 'ArrowLeft' && !newerBtn.disabled) {
      openReport(openIndex - 1);
    } else if (e.key === 'ArrowRight' && !olderBtn.disabled) {
      openReport(openIndex + 1);
    }
  });

  loadIndex();
})();
