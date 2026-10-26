import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Search, ArrowUpRight, ArrowRight, BookOpen, Sun, Moon, RefreshCw, Database,
  ChevronDown, SlidersHorizontal, X, FileText, CalendarDays, Bookmark, Users,
  ShieldCheck, LayoutGrid, List, ExternalLink, Info, LoaderCircle, CheckCircle2,
  AlertCircle, Library,
} from 'lucide-react';
import { fetchMonth } from './dataset';
import { loadPublishedData } from './static-data';
import Pagination from './Pagination';
import OcrReader from './OcrReader';
import FilterPanel from './FilterPanel';
import { groups, filterRows, classify, DATASET } from './search';
import './style.css';
import './filters.css';

const STATIC = import.meta.env.VITE_STATIC_DATA === 'true';
const defaults = {
  q: '', group: 'all', sub: '', from: '', to: '', scope: 'all',
  match: 'all', exclude: '', agency: '', ocr: false, sort: 'newest',
};
const dateTH = d => d
  ? new Date(`${d}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
  : 'ไม่ระบุวันที่';
const monthTH = m => m
  ? new Date(`${m}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' })
  : 'ไม่ระบุเดือน';

function App() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  const [allMonths, setAllMonths] = useState(false);
  const [selectedYears, setSelectedYears] = useState([String(new Date().getFullYear())]);
  const [loadProgress, setLoadProgress] = useState(null);
  const [pageSize, setPageSize] = useState(20);
  const [readerExpanded, setReaderExpanded] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 900);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [dataInfo, setDataInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState(null);
  const [connectionError, setConnectionError] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [f, setF] = useState(defaults);
  const [input, setInput] = useState('');
  const [toasts, setToasts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useState('list');
  const [savedOnly, setSavedOnly] = useState(false);
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem('saved') || '[]'); } catch { return []; }
  });
  const [help, setHelp] = useState(false);
  const request = useRef(0);

  const notify = (text, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, text, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  };
  const change = (key, value) => {
    setF(p => ({ ...p, [key]: value, ...(key === 'group' ? { sub: '' } : {}) }));
    setPage(1);
  };
  const setDateRange = (from, to) => {
    setF(p => ({ ...p, from, to }));
    setPage(1);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => { localStorage.setItem('saved', JSON.stringify(saved)); }, [saved]);
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') { setSelected(null); setHelp(false); setStatusOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => { setReaderExpanded(false); }, [selected?.id]);
  useEffect(() => {
    if (!selected && !help) return;
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.querySelector('[role="dialog"] .modal-close')?.focus({ preventScroll: true });
    const trap = e => {
      if (e.key !== 'Tab') return;
      const dialog = document.querySelector('[role="dialog"]');
      const controls = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        .filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trap);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [!!selected, help]);
  useEffect(() => { connect('', false, month, allMonths, selectedYears, undefined, { auto: true }); }, []);

  async function connect(_query = '', refresh = true, targetMonth = month, useAll = allMonths, years = selectedYears, range, options = {}) {
    const id = ++request.current;
    setLoading(true);
    setLoadProgress(null);
    notify('กำลังโหลดข้อมูลจริง…', 'loading');
    const apply = data => {
      if (id !== request.current) return;
      setRows(data.rows.map(row => ({ ...row, ...classify(row.title) })).filter(row => row.group !== 'other'));
      setDataInfo(data);
      setConnection(data.connectedAt);
      setConnectionError(!!data.stale || !!data.fallbackTo);
      setPage(1);
    };
    let fallback = null;
    try {
      if (STATIC) {
        const data = await loadPublishedData(import.meta.env.BASE_URL, targetMonth, {
          all: useAll, years, range, fallbackToLatest: !!options.auto,
          onProgress: p => { if (id === request.current) setLoadProgress(p); },
        });
        if (id !== request.current) return;
        apply(data);
        if (data.fallbackTo) {
          setMonth(data.fallbackTo);
          setSelectedYears([data.fallbackTo.slice(0, 4)]);
          setAllMonths(false);
          notify(`ยังไม่มี ${monthTH(targetMonth)} • แสดง ${monthTH(data.fallbackTo)} แทน`, 'error');
        } else {
          notify(`โหลด ${data.rows.length} ประกาศ • ${data.month}${data.stale ? ' • ข้อมูลอาจเก่า' : ''}`, data.stale ? 'error' : 'success');
        }
        return;
      }
      try {
        const r = await fetch(`/api/search?${new URLSearchParams({ month: targetMonth, refresh: refresh ? '1' : '0' })}`, { signal: AbortSignal.timeout(22000) });
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        fallback = data;
        if (data.stale && dataInfo?.month === targetMonth && dataInfo.complete) fallback = { ...dataInfo, rows, stale: true };
        apply(fallback);
      } catch { /* The browser may reach the public dataset when the API host cannot. */ }
      if (id !== request.current) return;
      if (!fallback || fallback.stale) {
        try {
          const direct = await fetchMonth(targetMonth);
          if (id !== request.current) return;
          apply(direct);
          notify(`โหลด ${direct.rows.length} ประกาศจาก ${direct.scanned} รายการ`);
          return;
        } catch (e) {
          if (id !== request.current) return;
          if (!fallback) throw e;
        }
      }
      notify(fallback.stale
        ? `เชื่อมต่อสดไม่ได้ • แสดงสำเนา ${fallback.rows.length} รายการ${fallback.complete ? '' : ' (บางส่วน)'}`
        : `พร้อมค้น ${fallback.rows.length} ประกาศ`, fallback.stale ? 'error' : 'success');
    } catch (e) {
      if (id !== request.current) return;
      setConnectionError(true);
      notify(STATIC ? e.message : 'โหลดเดือนที่เลือกไม่สำเร็จ', 'error');
    } finally {
      if (id === request.current) { setLoading(false); setLoadProgress(null); }
    }
  }

  async function loadOCR(query) {
    if (STATIC) {
      notify(`ค้น OCR ใน ${rows.filter(r => r.text).length} ฉบับที่นำเข้าแล้ว`);
      return;
    }
    if (!query.trim()) { notify('ระบุคำค้นสำหรับ OCR', 'error'); return; }
    const id = ++request.current;
    setLoading(true);
    notify('กำลังค้น OCR…', 'loading');
    try {
      const r = await fetch(`/api/ocr-search?${new URLSearchParams({ q: query })}`, { signal: AbortSignal.timeout(25000) });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      if (id !== request.current) return;
      const byId = new Map(data.rows.map(r => [r.id, r]));
      setRows(previous => previous.map(r => {
        const o = byId.get(r.id) || data.rows.find(x => x.id === r.pdfFile);
        return o?.text ? { ...r, text: o.text } : r;
      }));
      notify('โหลด OCR แล้ว');
    } catch {
      if (id === request.current) notify('บริการ OCR ไม่พร้อม • เปิด PDF ต้นฉบับแทน', 'error');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  function applyDateRange() {
    if (f.from && f.to && f.from > f.to) { notify('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด', 'error'); return; }
    if (STATIC && (f.from || f.to)) {
      connect(f.q, true, month, true, selectedYears, { from: f.from, to: f.to });
    } else {
      notify('ใช้ช่วงวันที่กับข้อมูลที่โหลดแล้ว');
    }
  }

  function search(e) {
    e?.preventDefault();
    if (f.from && f.to && f.from > f.to) { notify('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด', 'error'); return; }
    change('q', input);
    if (STATIC && (f.from || f.to)) {
      connect(input, true, month, true, selectedYears, { from: f.from, to: f.to });
    } else if (f.scope === 'text') {
      loadOCR(input);
    } else {
      notify('ค้นในข้อมูลที่โหลดแล้ว');
    }
  }

  function toggleSaved(r) {
    setSaved(p => p.includes(r.id) ? p.filter(x => x !== r.id) : [...p, r.id]);
    notify(saved.includes(r.id) ? 'นำออกจากรายการบันทึกแล้ว' : 'บันทึกประกาศแล้ว');
  }

  const filtered = filterRows(rows, f).filter(r => !savedOnly || saved.includes(r.id));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const coverage = dataInfo?.coverage;
  const currentMonthCount = coverage
    ? dataInfo.availableMonths?.find(m => m.month === coverage.currentMonth)?.count || 0
    : 0;
  const filterCount = [f.q, f.sub, f.from, f.to, f.exclude, f.agency, f.ocr, f.scope !== 'all', f.match !== 'all', f.group !== 'all'].filter(Boolean).length;
  const reset = () => { setF(defaults); setInput(''); setPage(1); setSavedOnly(false); notify('ล้างตัวกรองแล้ว'); };
  function highlight(text) {
    const term = f.q.trim();
    if (!term) return text;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    return idx < 0 ? text : <>{text.slice(0, idx)}<mark>{text.slice(idx, idx + term.length)}</mark>{text.slice(idx + term.length)}</>;
  }

  return (
    <>
      <header className="header">
        <a className="brand" href="#" onClick={e => { e.preventDefault(); reset(); }}>
          <span className="brand-icon"><Library size={22} /></span>
          <span>ราชค้น<small>RATCHA SEARCH</small></span>
        </a>
        <nav>
          <a className={!savedOnly ? 'nav-active' : ''} href="#results" onClick={() => setSavedOnly(false)}>ค้นหาประกาศ</a>
          <button className={savedOnly ? 'nav-active' : ''} onClick={() => { setSavedOnly(!savedOnly); setPage(1); document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }); }}>
            บันทึก {saved.length > 0 && <small>{saved.length}</small>}
          </button>
          <button onClick={() => setHelp(true)}>เกี่ยวกับข้อมูล <ArrowUpRight size={13} /></button>
        </nav>
        <div className="header-actions">
          <button className="icon-button theme-button" title={dark ? 'โหมดสว่าง' : 'โหมดมืด'} aria-label="สลับโหมดสี" onClick={() => setDark(!dark)}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="connection-wrap">
            <button className="connection-button" onClick={() => setStatusOpen(!statusOpen)} aria-expanded={statusOpen}>
              <span className={`tiny-dot ${connection && !connectionError ? 'green' : 'amber'}`} />
              <span>{loading ? 'กำลังโหลด' : connection && !connectionError ? 'ข้อมูลพร้อม' : 'สถานะข้อมูล'}</span>
              <ChevronDown size={13} />
            </button>
            {statusOpen && (
              <div className="connection-popover">
                <strong><Database size={16} /> สถานะข้อมูล</strong>
                <p>{connectionError ? 'ข้อมูลอาจเก่าหรือโหลดไม่สำเร็จ' : connection ? 'ซิงก์สำเร็จ' : 'กำลังโหลด'}</p>
                <p>{connection ? new Date(connection).toLocaleString('th-TH') : 'ยังไม่มีเวลา'}</p>
                {dataInfo && <p>{dataInfo.month} • {rows.length} ประกาศ • OCR {rows.filter(r => r.text).length}</p>}
                {coverage && <p>ความครบถ้วน: {coverage.status === 'complete' ? `ครบ ${coverage.requiredMonths} เดือน` : `ขาด ${coverage.missingMonths.length} เดือน`} • ล่าสุด {monthTH(coverage.latestMonth)}</p>}
                <a href={dataInfo?.source || DATASET} target="_blank" rel="noreferrer">ต้นทาง <ExternalLink size={13} /></a>
                <button className="primary small" disabled={loading} onClick={() => connect(f.q)}><RefreshCw size={14} className={loading ? 'spin' : ''} /> รีเฟรช</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="intro">
          <h1>ค้นประกาศราชกิจจานุเบกษา</h1>
          <p>แต่งตั้งบุคลากรและ ป.ป.ช. • ข้อมูลจริงจาก Open Law Data Thailand</p>
        </section>

        <section className="search-panel">
          <form onSubmit={search}>
            <div className="search-main">
              <Search size={21} />
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="ค้นชื่อประกาศ บุคคล หน่วยงาน หรือเนื้อหา…"
                aria-label="คำค้นหา"
              />
              {input && <button type="button" className="icon-button" aria-label="ล้างคำค้น" onClick={() => { setInput(''); change('q', ''); }}><X size={16} /></button>}
              <button className="primary" disabled={loading}>
                {loading ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />} ค้นหาประกาศ <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </section>

        <FilterPanel
          open={filtersOpen}
          onToggle={() => setFiltersOpen(p => !p)}
          filterCount={filterCount}
          onReset={reset}
          coverage={coverage}
          currentMonthCount={currentMonthCount}
          monthTH={monthTH}
          dateTH={dateTH}
          loading={loading}
          loadProgress={loadProgress}
          STATIC={STATIC}
          dataInfo={dataInfo}
          selectedYears={selectedYears}
          setSelectedYears={setSelectedYears}
          allMonths={allMonths}
          setAllMonths={setAllMonths}
          month={month}
          setMonth={setMonth}
          connect={connect}
          f={f}
          change={change}
          setDateRange={setDateRange}
          applyDateRange={applyDateRange}
          groups={groups}
          rows={rows}
          resultCount={filtered.length}
          savedOnly={savedOnly}
          onClearSaved={() => { setSavedOnly(false); setPage(1); }}
        />

        <section className="workspace" id="results">
          <div className="results">
            <div className="results-heading">
              <div><h2>{savedOnly ? 'ประกาศที่บันทึกไว้' : 'ผลการค้นหา'}<span>{filtered.length} รายการ</span></h2></div>
              <div className="result-tools">
                <select aria-label="เรียงลำดับ" value={f.sort} onChange={e => change('sort', e.target.value)}>
                  <option value="newest">ใหม่ที่สุด</option>
                  <option value="oldest">เก่าที่สุด</option>
                  <option value="title">ชื่อ ก–ฮ</option>
                </select>
                <div className="view-toggle">
                  <button aria-label="มุมมองรายการ" className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><List size={16} /></button>
                  <button aria-label="มุมมองตาราง" className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}><LayoutGrid size={16} /></button>
                </div>
              </div>
            </div>

            <div className={`dataset-banner ${dataInfo?.complete && !connectionError ? 'live' : ''}`}>
              <Info size={15} />
              <span>
                {dataInfo
                  ? `${dataInfo.month} • ${rows.length.toLocaleString('th-TH')} ประกาศ • OCR ${rows.filter(r => r.text).length.toLocaleString('th-TH')}${dataInfo.latestMonth ? ` • ล่าสุด ${monthTH(dataInfo.latestMonth)}` : ''}${connectionError ? ' • ตรวจสอบการซิงก์' : ''}`
                  : 'กำลังเตรียมข้อมูลจริง'}
              </span>
              {dataInfo && <a href={dataInfo.source} target="_blank" rel="noreferrer">ต้นทาง <ExternalLink size={12} /></a>}
            </div>

            <div className={`result-list ${view === 'grid' ? 'grid' : ''}`} aria-busy={loading}>
              {visible.map((r, i) => (
                <article className="result-card" key={r.id} style={{ animationDelay: `${i * 45}ms` }}>
                  <div className={`document-icon ${r.group === 'nacc' ? 'lavender' : ''}`}><FileText size={22} /></div>
                  <div className="card-content">
                    <div className="card-tags">
                      <span className={`tag ${r.group === 'nacc' ? 'purple' : ''}`}>{r.group === 'nacc' ? 'ป.ป.ช.' : 'แต่งตั้ง'}</span>
                      <span className="sub-tag">{r.sub}</span>
                      {r.text && <span className="ocr-tag">OCR</span>}
                    </div>
                    <button className="document-title" onClick={() => setSelected(r)}>{highlight(r.title)}</button>
                    <div className="card-meta">
                      <span><CalendarDays size={13} />{dateTH(r.date)}</span>
                      <span>เล่ม {r.volume || '–'} ตอน {r.part || '–'}</span>
                      <span>{r.issuer || 'ไม่ระบุหน่วยงาน'}</span>
                    </div>
                    {f.q && f.scope !== 'title' && r.text.includes(f.q) && (
                      <p className="snippet">…{highlight(r.text.slice(Math.max(0, r.text.indexOf(f.q) - 25), r.text.indexOf(f.q) + 90))}…</p>
                    )}
                    <div className="card-bottom">
                      <button onClick={() => setSelected(r)}>อ่านประกาศ <ArrowUpRight size={13} /></button>
                      <span>Open Law Data Thailand</span>
                    </div>
                  </div>
                  <button className={`bookmark icon-button ${saved.includes(r.id) ? 'is-saved' : ''}`} aria-label={saved.includes(r.id) ? 'เลิกบันทึก' : 'บันทึก'} onClick={() => toggleSaved(r)}>
                    <Bookmark size={17} fill={saved.includes(r.id) ? 'currentColor' : 'none'} />
                  </button>
                </article>
              ))}
            </div>

            {!filtered.length && (
              <div className="empty">
                <BookOpen size={36} />
                <h3>{loading ? 'กำลังโหลด…' : 'ไม่พบรายการ'}</h3>
                <button className="primary" onClick={reset}>ล้างตัวกรอง</button>
              </div>
            )}

            <Pagination
              page={safePage}
              pages={pages}
              total={filtered.length}
              pageSize={pageSize}
              onPage={n => {
                setPage(n);
                document.querySelector('.results-heading')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
              }}
              onSize={n => { setPageSize(n); setPage(1); }}
              notify={notify}
            />
          </div>
        </section>
      </main>

      <footer>
        <a className="footer-brand" href="#"><Library size={18} /> ราชค้น</a>
        <span>ข้อมูลจาก <a href={DATASET} target="_blank" rel="noreferrer">Open Law Data Thailand</a> · CC BY 4.0</span>
        <span>ตรวจสอบ PDF ต้นฉบับก่อนอ้างอิง</span>
      </footer>

      <div className="toast-stack" aria-live="polite">
        {toasts.map(t => (
          <div className={`toast ${t.type}`} key={t.id}>
            {t.type === 'error' ? <AlertCircle size={18} /> : t.type === 'loading' ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />}
            <span>{t.text}</span>
            <button aria-label="ปิดการแจ้งเตือน" onClick={() => setToasts(p => p.filter(x => x.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>

      {(selected || help) && (
        <div className="modal-backdrop" onClick={() => { setSelected(null); setHelp(false); }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label={help ? 'เกี่ยวกับข้อมูล' : 'รายละเอียดประกาศ'}
            className={`modal ${selected && readerExpanded ? 'modal-reader-expanded' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            <button className="modal-close icon-button" aria-label="ปิด" onClick={() => { setSelected(null); setHelp(false); }}><X /></button>
            {help ? (
              <>
                <div className="modal-symbol"><Database /></div>
                <h2>เกี่ยวกับข้อมูล</h2>
                <p>ราชค้นใช้ชุดข้อมูล soc-ratchakitcha ของ Open Law Data Thailand (CC BY 4.0) คัดเฉพาะประกาศแต่งตั้งและประกาศเกี่ยวกับ ป.ป.ช.</p>
                <p>GitHub Actions ซิงก์ metadata และ OCR ทุกวัน ตรวจสอบขนาดไฟล์ จำนวนบรรทัด revision และความครบถ้วนของเดือนปัจจุบันก่อนเผยแพร่</p>
                <p>OCR อาจคลาดเคลื่อน ควรตรวจสอบ PDF ต้นฉบับก่อนใช้เป็นหลักฐานทางกฎหมาย</p>
                <a className="primary" href={DATASET} target="_blank" rel="noreferrer">เปิดฐานข้อมูลต้นทาง <ExternalLink size={15} /></a>
              </>
            ) : (
              <>
                <span className="tag">{selected.sub}</span>
                <h2>{selected.title}</h2>
                <p className="modal-date"><CalendarDays size={15} />{dateTH(selected.date)} · เล่ม {selected.volume} ตอน {selected.part}</p>
                <div className="ocr-notice"><Info size={15} /> {selected.text ? 'ข้อความ OCR อาจคลาดเคลื่อน' : 'ยังไม่มีข้อความ OCR'}</div>
                <OcrReader key={selected.id} text={selected.text || ''} query={f.q} mode={f.match} expanded={readerExpanded} onExpand={() => setReaderExpanded(p => !p)} />
                <div className="modal-actions">
                  <button onClick={() => toggleSaved(selected)}><Bookmark size={16} /> {saved.includes(selected.id) ? 'บันทึกแล้ว' : 'บันทึก'}</button>
                  {selected.pdf
                    ? <a className="primary" href={selected.pdf} target="_blank" rel="noreferrer">เปิด PDF ต้นฉบับ <ExternalLink size={15} /></a>
                    : <a href={DATASET} target="_blank" rel="noreferrer">ไม่พบ PDF • ไปที่ฐานข้อมูล <ExternalLink size={14} /></a>}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
