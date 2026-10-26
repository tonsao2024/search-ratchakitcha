import React from 'react';
import {
  SlidersHorizontal, ChevronDown, CalendarDays, Database, Search,
  LayoutGrid, Users, ShieldCheck, X, RefreshCw, Info, Check,
} from 'lucide-react';
import YearPicker, { yearLabel } from './YearPicker';
import ThaiDatePicker from './ThaiDatePicker';

function Group({ title, icon: Icon, children, className = '' }) {
  return (
    <section className={`filter-group ${className}`}>
      <h3>{Icon && <Icon size={16} />}{title}</h3>
      <div className="filter-group-body">{children}</div>
    </section>
  );
}

export default function FilterPanel({
  open, onToggle, filterCount, onReset,
  coverage, currentMonthCount, monthTH, dateTH,
  loading, loadProgress, STATIC, dataInfo,
  selectedYears, setSelectedYears, allMonths, setAllMonths,
  month, setMonth, connect,
  f, change, setDateRange, applyDateRange,
  groups, rows, resultCount, savedOnly, onClearSaved,
}) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <section className="filter-panel" aria-label="ตัวกรองการค้นหา">
      <header className="filter-panel-header">
        <button
          type="button"
          className="filter-toggle"
          aria-label="ตัวกรอง"
          aria-expanded={open}
          aria-controls="filter-panel-body"
          onClick={onToggle}
        >
          <SlidersHorizontal size={18} />
          <span>ตัวกรอง</span>
          {filterCount > 0 && <b aria-hidden="true">{filterCount}</b>}
          <ChevronDown size={16} className={open ? 'rotate' : ''} />
        </button>
        <div className="filter-panel-actions">
          <span className={`coverage-status${dataInfo?.fallbackTo ? ' warn' : ''}`} role="status" aria-live="polite">
            {loading
              ? 'กำลังโหลดข้อมูล…'
              : dataInfo?.fallbackTo
                ? `ต้นทางยังไม่มีไฟล์เดือน${dataInfo.requestedMonth ? ` ${monthTH(dataInfo.requestedMonth)}` : ''} • แสดง ${monthTH(dataInfo.fallbackTo)} แทน • ผลลัพธ์ ${resultCount.toLocaleString('th-TH')} ประกาศ`
                : `ผลลัพธ์ ${resultCount.toLocaleString('th-TH')} ประกาศ จากข้อมูลที่โหลด ${rows.length.toLocaleString('th-TH')} รายการ`}
          </span>
          <button type="button" className="filter-reset" onClick={onReset}>ล้างค่า</button>
        </div>
      </header>

      {(
        <div className="active-filters" aria-label="ตัวกรองที่ใช้">
          <span className="filter-context">ช่วงข้อมูล: {STATIC && allMonths ? `${yearLabel(selectedYears)}${selectedYears === null ? '' : ' พ.ศ.'} · ทุกเดือน` : monthTH(month)}</span>
          {f.group !== 'all' && <button type="button" onClick={() => change('group', 'all')}>{f.group === 'nacc' ? 'ป.ป.ช.' : 'แต่งตั้งบุคลากร'}<X size={12} /></button>}
          {savedOnly && <button type="button" onClick={onClearSaved}>เฉพาะที่บันทึกไว้<X size={12} /></button>}
          {f.exclude && <button type="button" onClick={() => change('exclude', '')}>ไม่รวม: {f.exclude}<X size={12} /></button>}
          {f.agency && <button type="button" onClick={() => change('agency', '')}>หน่วยงาน: {f.agency}<X size={12} /></button>}
          {f.ocr && <button type="button" onClick={() => change('ocr', false)}>มี OCR<X size={12} /></button>}
          {f.scope !== 'all' && <button type="button" onClick={() => change('scope', 'all')}>ค้นใน: {f.scope === 'title' ? 'ชื่อประกาศ' : 'เนื้อหา OCR'}<X size={12} /></button>}
          {f.match !== 'all' && <button type="button" onClick={() => change('match', 'all')}>{f.match === 'any' ? 'ตรงคำใดคำหนึ่ง (OR)' : 'ตรงทั้งวลี'}<X size={12} /></button>}
          {f.sort !== 'newest' && <button type="button" onClick={() => change('sort', 'newest')}>เรียง: {f.sort === 'oldest' ? 'เก่าสุด' : 'ชื่อประกาศ'}<X size={12} /></button>}
          {f.q && <button type="button" onClick={() => change('q', '')}>คำค้น: {f.q}<X size={12} /></button>}
          {f.sub && <button type="button" onClick={() => change('sub', '')}>{f.sub}<X size={12} /></button>}
          {(f.from || f.to) && (
            <button type="button" onClick={() => setDateRange('', '')}>
              {f.from ? dateTH(f.from) : 'เริ่มต้น'} – {f.to ? dateTH(f.to) : 'ปัจจุบัน'}<X size={12} />
            </button>
          )}
          <button type="button" onClick={onReset}>ล้างทั้งหมด</button>
        </div>
      )}

      {loading && loadProgress && (
        <div className="year-load-progress" role="status">
          โหลด {loadProgress.loaded}/{loadProgress.total} ไฟล์
          <progress value={loadProgress.loaded} max={loadProgress.total} />
        </div>
      )}

      {open && (
        <div className="filter-panel-body" id="filter-panel-body">
          <div className="filter-grid">
            <Group title="ช่วงข้อมูล" icon={CalendarDays} className="filter-group-period">
              <div className="filter-inline">
                {STATIC && (
                  <YearPicker
                    years={dataInfo?.availableYears || [String(new Date().getFullYear())]}
                    value={selectedYears}
                    disabled={loading}
                    onApply={years => {
                      setSelectedYears(years);
                      setAllMonths(true);
                      const targetMonth = years?.length === 1 ? `${years[0]}-01` : month;
                      if (years?.length === 1) setMonth(targetMonth);
                      connect('', true, targetMonth, true, years);
                    }}
                  />
                )}
                <div className="filter-field filter-month">
                  <span>เดือน / ปี พ.ศ.</span>
                  <ThaiDatePicker label="เดือนของฐานข้อมูล" monthOnly disabled={loading || (STATIC && allMonths)} value={month} min={dataInfo?.availableMonths?.[0]?.month || '1885-01'} max={thisMonth} onChange={value => { setMonth(value); if (value) setSelectedYears([value.slice(0, 4)]); }} />
                </div>
              </div>
              {STATIC && (
                <label className="filter-check">
                  <input
                    type="checkbox"
                    checked={allMonths}
                    disabled={loading || selectedYears === null || selectedYears.length !== 1}
                    onChange={e => {
                      setAllMonths(e.target.checked);
                      connect('', true, month, e.target.checked);
                    }}
                  />
                  ทุกเดือนของปีที่เลือก
                </label>
              )}
              <div className="filter-inline filter-dates">
                <div className="filter-field">ตั้งแต่วันที่<ThaiDatePicker label="ตั้งแต่วันที่" value={f.from} max={f.to || undefined} onChange={value => change('from', value)} /></div>
                <div className="filter-field">ถึงวันที่<ThaiDatePicker label="ถึงวันที่" value={f.to} min={f.from || undefined} onChange={value => change('to', value)} /></div>
              </div>
              <div className="date-shortcuts">
                <button type="button" onClick={() => {
                  const end = new Date(), start = new Date();
                  start.setDate(start.getDate() - 30);
                  setDateRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
                }}>30 วัน</button>
                <button type="button" onClick={() => {
                  const y = new Date().getFullYear();
                  setDateRange(`${y}-01-01`, `${y}-12-31`);
                }}>ปีนี้</button>
                <button type="button" onClick={() => setDateRange('', '')}>ทั้งหมด</button>
              </div>
              <div className="filter-actions">
                <button type="button" className="filter-load" disabled={loading || !month} onClick={() => connect('', true, month)}>
                  <RefreshCw size={14} className={loading ? 'spin' : ''} /> โหลด / รีเฟรช
                </button>
                <button type="button" className="filter-load" disabled={loading} onClick={() => {
                  const year = thisMonth.slice(0, 4);
                  setMonth(thisMonth); setSelectedYears([year]); setAllMonths(false);
                  connect('', true, thisMonth, false, [year]);
                }}>เดือนปัจจุบัน</button>
                <button type="button" className="filter-apply" onClick={applyDateRange}>ใช้ช่วงวันที่</button>
              </div>
            </Group>

            <Group title="ประเภทประกาศ" icon={LayoutGrid} className="filter-group-category">
              <div className="filter-categories">
                <button type="button" className={`category ${f.group === 'all' ? 'selected' : ''}`} onClick={() => change('group', 'all')}>
                  <span><LayoutGrid size={16} /> ทั้งหมด</span><small>{rows.length}</small>
                </button>
                {[['appointments', Users, 'แต่งตั้งบุคลากร'], ['nacc', ShieldCheck, 'ป.ป.ช.']].map(([key, Icon, label]) => (
                  <React.Fragment key={key}>
                    <button type="button" className={`category ${f.group === key ? 'selected' : ''}`} onClick={() => change('group', key)}>
                      <span><Icon size={16} /> {label}</span><ChevronDown size={13} />
                    </button>
                    {f.group === key && (
                      <div className="subcategories">
                        {groups[key].map(sub => (
                          <label key={sub}>
                            <input type="radio" name="sub" checked={f.sub === sub} onChange={() => change('sub', sub)} />
                            {sub}<small>{rows.filter(row => row.sub === sub).length}</small>
                          </label>
                        ))}
                        {f.sub && <button type="button" onClick={() => change('sub', '')}>ทุกประเภทย่อย</button>}
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </Group>

            <Group title="คำค้นและเงื่อนไข" icon={Search} className="filter-group-query">
              <fieldset className="filter-scope">
                <legend>ค้นหาใน</legend>
                {[['all', 'ทั้งหมด'], ['title', 'ชื่อประกาศ'], ['text', 'เนื้อหา OCR']].map(([key, label]) => (
                  <label key={key}>
                    <input type="radio" name="scope" checked={f.scope === key} onChange={() => change('scope', key)} />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="filter-inline filter-query-fields">
                <label className="filter-field">
                  <span>เงื่อนไขคำค้น</span>
                  <select value={f.match} onChange={e => change('match', e.target.value)}>
                    <option value="all">ตรงทุกคำ (AND)</option>
                    <option value="any">ตรงคำใดคำหนึ่ง (OR)</option>
                    <option value="exact">ตรงทั้งวลี</option>
                  </select>
                </label>
                <label className="filter-field">
                  <span>ไม่รวมคำ</span>
                  <input value={f.exclude} onChange={e => change('exclude', e.target.value)} placeholder="คำที่ไม่ต้องการ" />
                </label>
                <label className="filter-field">
                  <span>หน่วยงาน</span>
                  <input value={f.agency} onChange={e => change('agency', e.target.value)} placeholder="ชื่อหน่วยงาน" />
                </label>
              </div>
              <label className="filter-check">
                <input type="checkbox" checked={f.ocr} onChange={e => change('ocr', e.target.checked)} />
                เฉพาะที่มีข้อความ OCR
              </label>
            </Group>
          </div>
        </div>
      )}
    </section>
  );
}
