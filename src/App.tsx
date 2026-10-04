/* ============================================================
   ClassAttend — Classroom Attendance Recorder
   App.tsx — Full React implementation with embedded logic
   ============================================================ */

import { useEffect, useRef, useCallback, useState } from 'react';
import './index.css';

/* ── Constants ─────────────────────────────────────────────── */
const STORAGE_KEY = 'classattend_v1_state';
const THEME_KEY   = 'classattend_v1_theme';

/** All roll numbers in canonical display order */
const ROLL_NUMBERS: string[] = [
  'LE01',
  ...Array.from({ length: 53 }, (_, i) => String(i + 1)),
];

/** Sorting: LE01 first, then numeric ascending */
function sortRolls(a: string, b: string): number {
  if (a === 'LE01') return -1;
  if (b === 'LE01') return 1;
  return parseInt(a, 10) - parseInt(b, 10);
}

/* ── Date helpers ───────────────────────────────────────────── */
function getTodayISO(): string {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, '0');
  const d   = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateOutput(iso: string): string {
  // YYYY-MM-DD → D/M/YY
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}/${m}/${String(y).slice(-2)}`;
}

/* ── Persisted state type ───────────────────────────────────── */
interface SavedState {
  selected:       string[];
  attendanceType: string;
  date:           string;
}

/* ================================================================
   Main Component
   ================================================================ */
export default function App() {
  /* ── Reactive State ─────────────────────────────────────────── */
  const [theme,          setTheme]          = useState<'light' | 'dark'>('light');
  const [attendanceType, setAttendanceType] = useState<string>('PRESENTEES');
  const [date,           setDate]           = useState<string>(getTodayISO());
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [searchQuery,    setSearchQuery]    = useState<string>('');
  const [modalOpen,      setModalOpen]      = useState<boolean>(false);
  const [_focusedIndex,  setFocusedIndex]   = useState<number>(-1);
  const [,               setIsKbMode]       = useState<boolean>(false);

  /* ── Refs ────────────────────────────────────────────────────── */
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toastTimers    = useRef<Map<HTMLElement, ReturnType<typeof setTimeout>>>(new Map());

  /* ── Derived values ──────────────────────────────────────────── */
  const sortedSelected = [...selected].sort(sortRolls);

  function buildAttendanceText(): string {
    if (selected.size === 0) return '';
    return `${attendanceType}\n\n${formatDateOutput(date)}\n\n${sortedSelected.join(',')}`;
  }

  const previewInline = sortedSelected.join(',');
  const fullOutput    = buildAttendanceText();

  /* Search filter */
  const searchLower = searchQuery.toLowerCase().trim();
  const matchedRolls: Set<string> = new Set(
    searchLower
      ? ROLL_NUMBERS.filter(r => r.toLowerCase().includes(searchLower))
      : ROLL_NUMBERS
  );
  const searchActive  = searchLower.length > 0;
  const matchCount    = searchActive ? matchedRolls.size : 0;

  /* Visible (non-dimmed) roll numbers for keyboard nav */
  const visibleRolls = ROLL_NUMBERS.filter(r => !searchActive || matchedRolls.has(r));

  /* ── Theme ───────────────────────────────────────────────────── */
  useEffect(() => {
    const saved = (localStorage.getItem(THEME_KEY) as 'light' | 'dark') || 'light';
    setTheme(saved);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  /* ── Load persisted state ────────────────────────────────────── */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved: SavedState = JSON.parse(raw);
      if (saved.selected)       setSelected(new Set(saved.selected));
      if (saved.attendanceType) setAttendanceType(saved.attendanceType);
      if (saved.date)           setDate(saved.date);
    } catch { /* ignore */ }
  }, []);

  /* ── Persist state on every change ──────────────────────────── */
  useEffect(() => {
    try {
      const toSave: SavedState = {
        selected:       [...selected],
        attendanceType,
        date,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch { /* ignore */ }
  }, [selected, attendanceType, date]);

  /* ── Toggle roll number ──────────────────────────────────────── */
  const toggleRoll = useCallback((roll: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(roll)) next.delete(roll);
      else                next.add(roll);
      return next;
    });
  }, []);

  /* ── Ripple helper ───────────────────────────────────────────── */
  function addRipple(btn: HTMLButtonElement, e: React.MouseEvent | MouseEvent) {
    const ripple = document.createElement('span');
    const rect   = btn.getBoundingClientRect();
    const size   = Math.max(rect.width, rect.height);
    const x      = e.clientX - rect.left - size / 2;
    const y      = e.clientY - rect.top  - size / 2;

    ripple.className     = 'ripple';
    ripple.style.width   = ripple.style.height = `${size}px`;
    ripple.style.left    = `${x}px`;
    ripple.style.top     = `${y}px`;
    ripple.style.background = selected.has(btn.dataset.roll || '')
      ? 'rgba(255,255,255,0.35)'
      : 'rgba(79,70,229,0.22)';

    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }

  /* ── Pop animation helper ────────────────────────────────────── */
  function popBtn(roll: string) {
    const btn = document.querySelector<HTMLButtonElement>(`[data-roll="${roll}"]`);
    if (!btn) return;
    btn.classList.remove('select-anim');
    void btn.offsetWidth; // reflow
    btn.classList.add('select-anim');
    btn.addEventListener('animationend', () => btn.classList.remove('select-anim'), { once: true });
  }

  /* ── Toast ───────────────────────────────────────────────────── */
  function showToast(
    message: string,
    type: 'success' | 'error' | 'info' | 'warning' = 'info',
    duration = 3200
  ) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const iconMap = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast   = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${iconMap[type]}</span>
      <span class="toast-msg">${message}</span>
    `;

    container.appendChild(toast);
    void toast.offsetWidth;
    toast.classList.add('show');

    const remove = () => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      toast.addEventListener('transitionend', () => {
        toast.remove();
        toastTimers.current.delete(toast);
      }, { once: true });
    };

    const tid = setTimeout(remove, duration);
    toastTimers.current.set(toast, tid);
    toast.addEventListener('click', () => { clearTimeout(tid); remove(); });
  }

  /* ── Copy to clipboard ───────────────────────────────────────── */
  async function copyAttendance() {
    if (selected.size === 0) {
      showToast('No roll numbers selected!', 'warning');
      return;
    }

    const text    = buildAttendanceText();
    const doneBtn = document.getElementById('done-btn') as HTMLButtonElement | null;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers / non-HTTPS
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }

      doneBtn?.classList.add('copy-success');
      doneBtn?.addEventListener('animationend', () => doneBtn.classList.remove('copy-success'), { once: true });
      showToast('Attendance copied to clipboard!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Could not copy — please copy manually.', 'error');
    }
  }

  /* ── Reset ───────────────────────────────────────────────────── */
  function doReset() {
    // Shake animation
    document.body.classList.add('resetting');
    setTimeout(() => document.body.classList.remove('resetting'), 420);

    setSelected(new Set());
    setAttendanceType('PRESENTEES');
    setDate(getTodayISO());
    setSearchQuery('');
    setModalOpen(false);
    showToast('Attendance reset!', 'info', 2400);
  }

  /* ── Quick select ────────────────────────────────────────────── */
  function selectAll() {
    setSelected(new Set(ROLL_NUMBERS));
    showToast('All roll numbers selected!', 'success', 2000);
  }
  function selectNone() {
    setSelected(new Set());
  }

  /* ── Keyboard navigation ─────────────────────────────────────── */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement as HTMLElement;
      const onInput = ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);

      if (e.key === 'Escape') {
        if (modalOpen) { setModalOpen(false); return; }
        setSearchQuery('');
        searchInputRef.current?.blur();
        return;
      }

      // Arrow / space navigation (only when not on input)
      if (!onInput) {
        if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          setIsKbMode(true);
          document.body.classList.add('keyboard-active');

          setFocusedIndex(prev => {
            let next = prev;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
              next = Math.min(prev + 1, visibleRolls.length - 1);
            else
              next = Math.max(prev - 1, 0);

            if (next < 0) next = 0;
            const roll = visibleRolls[next];
            const btn  = document.querySelector<HTMLButtonElement>(`[data-roll="${roll}"]`);
            btn?.focus();
            return next;
          });
          return;
        }

        if ((e.key === ' ' || e.key === 'Enter') && active.classList.contains('roll-btn')) {
          e.preventDefault();
          const roll = active.dataset.roll;
          if (roll) {
            toggleRoll(roll);
            popBtn(roll);
          }
        }
      }
    }

    function onMouseDown() {
      setIsKbMode(false);
      document.body.classList.remove('keyboard-active');
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [modalOpen, visibleRolls, toggleRoll]);

  /* ── When search changes, auto-scroll first match ────────────── */
  useEffect(() => {
    if (!searchActive) return;
    const first = document.querySelector<HTMLButtonElement>('.roll-btn.search-highlighted');
    first?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setFocusedIndex(-1);
  }, [searchQuery]);

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <>
      {/* ── Ambient background ──────────────────────────────────── */}
      <div id="app-bg" aria-hidden="true">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="bg-orb bg-orb-3" />
      </div>

      {/* ── Main container ──────────────────────────────────────── */}
      <div id="app-container">

        {/* ═══════════════════════════════════════
            HEADER
            ═══════════════════════════════════════ */}
        <header id="app-header" role="banner">
          <div className="header-brand">
            <div className="brand-icon" aria-hidden="true">📋</div>
            <div className="brand-text">
              <h1>ClassAttend</h1>
              <p>Classroom Attendance Recorder</p>
            </div>
          </div>

          <div className="header-actions">
            <button
              id="theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title="Toggle Theme"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </header>

        {/* ═══════════════════════════════════════
            CONTROLS BAR
            ═══════════════════════════════════════ */}
        <section id="controls-bar" aria-label="Attendance Controls">

          {/* Attendance Type */}
          <div className="control-group">
            <label className="control-label" htmlFor="attendance-type">Type</label>
            <select
              id="attendance-type"
              className="control-select"
              value={attendanceType}
              onChange={e => setAttendanceType(e.target.value)}
              aria-label="Attendance type"
            >
              <option value="PRESENTEES">PRESENTEES</option>
              <option value="ABSENTEES">ABSENTEES</option>
            </select>
          </div>

          {/* Date Picker */}
          <div className="control-group">
            <label className="control-label" htmlFor="date-picker">Date</label>
            <input
              type="date"
              id="date-picker"
              className="control-date"
              value={date}
              onChange={e => setDate(e.target.value)}
              aria-label="Attendance date"
            />
          </div>

          <div className="controls-divider" aria-hidden="true" />

          {/* Reset Button */}
          <button
            id="reset-btn"
            className="action-btn btn-reset"
            onClick={() => setModalOpen(true)}
            aria-label="Reset all selections"
            title="Reset"
          >
            <span aria-hidden="true">↺</span>
            <span>Reset</span>
          </button>

          {/* Done / Copy Button */}
          <button
            id="done-btn"
            className="action-btn btn-done"
            onClick={copyAttendance}
            aria-label="Copy attendance to clipboard"
            title="Done & Copy"
          >
            <span aria-hidden="true">📋</span>
            <span>Done / Copy</span>
          </button>
        </section>

        {/* ═══════════════════════════════════════
            SEARCH BAR
            ═══════════════════════════════════════ */}
        <section id="search-bar" role="search" aria-label="Search roll numbers">
          <span className="search-icon" aria-hidden="true">🔍</span>
          <input
            ref={searchInputRef}
            type="search"
            id="search-input"
            placeholder="Search roll number (e.g. 17, LE01)…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search roll numbers"
            autoComplete="off"
            spellCheck={false}
          />
          <span
            className="search-result-count"
            aria-live="polite"
            aria-label={searchActive ? `${matchCount} matches` : ''}
          >
            {searchActive
              ? matchCount > 0
                ? `${matchCount} match${matchCount !== 1 ? 'es' : ''}`
                : 'No matches'
              : ''}
          </span>
          <button
            id="search-clear"
            className={searchQuery ? 'visible' : ''}
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            title="Clear search"
          >
            ✕
          </button>
        </section>

        {/* ═══════════════════════════════════════
            ROLL NUMBER GRID
            ═══════════════════════════════════════ */}
        <section id="grid-container" aria-label="Roll Number Selection Grid">
          <div className="grid-header">
            <div className="grid-title">Select Roll Numbers</div>

            <div className="grid-stats">
              <span className="stat-chip" aria-label={`${selected.size} of ${ROLL_NUMBERS.length} selected`}>
                {selected.size} / {ROLL_NUMBERS.length}
              </span>
              <div className="quick-actions">
                <button
                  className="quick-btn"
                  onClick={selectAll}
                  aria-label="Select all roll numbers"
                >
                  All
                </button>
                <button
                  className="quick-btn"
                  onClick={selectNone}
                  aria-label="Clear all selections"
                >
                  None
                </button>
              </div>
            </div>
          </div>

          {/* Grid */}
          <div
            id="roll-grid"
            role="group"
            aria-label={`Roll number buttons — ${selected.size} selected`}
          >
            {ROLL_NUMBERS.map((roll, idx) => {
              const isSelected    = selected.has(roll);
              const isSpecial     = roll === 'LE01';
              const isDimmed      = searchActive && !matchedRolls.has(roll);
              const isHighlighted = searchActive && matchedRolls.has(roll);

              let cls = 'roll-btn';
              if (isSpecial)     cls += ' special';
              if (isSelected)    cls += ' selected';
              if (isDimmed)      cls += ' dimmed';
              if (isHighlighted && !isSelected) cls += ' highlighted';

              return (
                <button
                  key={roll}
                  className={cls}
                  data-roll={roll}
                  data-index={idx}
                  role="checkbox"
                  aria-pressed={isSelected}
                  aria-label={`Roll number ${roll}${isSelected ? ', selected' : ''}`}
                  tabIndex={isDimmed ? -1 : 0}
                  onClick={(e) => {
                    const btn = e.currentTarget;
                    addRipple(btn, e.nativeEvent);
                    toggleRoll(roll);
                    popBtn(roll);
                  }}
                  onFocus={() => {
                    const i = visibleRolls.indexOf(roll);
                    if (i !== -1) setFocusedIndex(i);
                  }}
                >
                  {roll}
                </button>
              );
            })}
          </div>

          {/* Keyboard hint */}
          <div className="keyboard-hint" aria-hidden="true">
            <span className="kbd">←→↑↓</span>
            &nbsp;Navigate&nbsp;·&nbsp;
            <span className="kbd">Space</span>
            &nbsp;Toggle&nbsp;·&nbsp;
            <span className="kbd">Esc</span>
            &nbsp;Clear search
          </div>
        </section>

        {/* ═══════════════════════════════════════
            LIVE PREVIEW PANEL
            ═══════════════════════════════════════ */}
        <section
          id="preview-panel"
          aria-label="Live attendance preview"
          aria-live="polite"
          aria-atomic="false"
        >
          <div className="preview-header">
            <div className="preview-title">
              <span className="pulse-dot" aria-hidden="true" />
              Live Preview
            </div>
            <div className="preview-meta">
              <span
                className="preview-badge badge-type"
                aria-label={`Attendance type: ${attendanceType}`}
              >
                {attendanceType}
              </span>
              <span
                className="preview-badge badge-count"
                aria-label={`Total selected: ${selected.size}`}
              >
                Total Selected: {selected.size}
              </span>
            </div>
          </div>

          {/* Inline roll list */}
          <div className="preview-content">
            <div className="preview-text" aria-label="Selected roll numbers">
              {selected.size === 0
                ? <span className="preview-empty">No roll numbers selected yet…</span>
                : previewInline
              }
            </div>
          </div>

          {/* Full formatted output */}
          {selected.size > 0 && (
            <div className="preview-full">
              <div className="preview-full-label">Output Format</div>
              <pre
                className="preview-output-text"
                aria-label="Formatted attendance output ready to copy"
              >
                {fullOutput}
              </pre>
            </div>
          )}
        </section>

        {/* ═══════════════════════════════════════
            FOOTER
            ═══════════════════════════════════════ */}
        <footer id="app-footer" role="contentinfo">
          ClassAttend · Works 100% offline · Data saved locally · Made with ❤️ for educators
        </footer>

      </div>{/* end #app-container */}

      {/* ═══════════════════════════════════════
          TOAST CONTAINER
          ═══════════════════════════════════════ */}
      <div
        id="toast-container"
        role="region"
        aria-label="Notifications"
        aria-live="assertive"
      />

      {/* ═══════════════════════════════════════
          CONFIRMATION MODAL
          ═══════════════════════════════════════ */}
      <div
        id="modal-overlay"
        className={modalOpen ? 'active' : ''}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby="modal-desc"
        onClick={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}
      >
        <div className="modal-card" role="document">
          <div className="modal-icon" aria-hidden="true">🔄</div>
          <h2 className="modal-title" id="modal-title">Reset Attendance?</h2>
          <p className="modal-desc" id="modal-desc">
            This will clear all selected roll numbers and reset the date and
            attendance type to defaults. This action cannot be undone.
          </p>
          <div className="modal-actions">
            <button
              className="modal-btn modal-btn-cancel"
              onClick={() => setModalOpen(false)}
              aria-label="Cancel reset"
            >
              Cancel
            </button>
            <button
              className="modal-btn modal-btn-confirm"
              onClick={doReset}
              aria-label="Confirm reset"
              autoFocus={modalOpen}
            >
              Yes, Reset
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
