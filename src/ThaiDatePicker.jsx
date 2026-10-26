import React, { useEffect, useState } from 'react';

export const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

// Keep ISO values at the data boundary; never depend on the browser's calendar locale.
export default function ThaiDatePicker({ value, onChange, label, monthOnly = false, disabled = false, min, max }) {
  const [parts, setParts] = useState(value ? value.split('-') : ['', '', '']);
  useEffect(() => setParts(value ? value.split('-') : ['', '', '']), [value]);
  const [year, month, day] = parts;
  const days = year && month ? new Date(Number(year), Number(month), 0).getDate() : 31;
  function update(index, next) {
    if (!next) { setParts(['', '', '']); onChange(''); return; }
    const updated = [...parts];
    updated[index] = next;
    if (updated[0] && updated[1] && updated[2]) {
      updated[2] = String(Math.min(Number(updated[2]), new Date(Number(updated[0]), Number(updated[1]), 0).getDate())).padStart(2, '0');
    }
    setParts(updated);
    if (updated[0] && updated[1] && (monthOnly || updated[2])) {
      const iso = updated.slice(0, monthOnly ? 2 : 3).join('-');
      if ((!min || iso >= min) && (!max || iso <= max)) onChange(iso);
    }
  }
  const maxYear = Math.max(new Date().getFullYear() + 1, Number(year) || 0);
  const pending = year && month && (monthOnly || day) ? parts.slice(0, monthOnly ? 2 : 3).join('-') : '';
  const invalid = pending && ((min && pending < min) || (max && pending > max));
  return <div className="thai-date-picker" role="group" aria-label={label}>
    <div className="thai-date-fields">
      {!monthOnly && <select aria-label={`${label} วัน`} disabled={disabled} value={day || ''} onChange={e => update(2, e.target.value)}><option value="">วัน</option>{Array.from({length: days}, (_, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{i + 1}</option>)}</select>}
      <select aria-label={`${label} เดือน`} disabled={disabled} value={month || ''} onChange={e => update(1, e.target.value)}><option value="">เดือน</option>{thaiMonths.map((name, i) => <option key={name} value={String(i + 1).padStart(2, '0')}>{name}</option>)}</select>
      <select aria-label={`${label} ปี พ.ศ.`} disabled={disabled} value={year || ''} onChange={e => update(0, e.target.value)}><option value="">ปี พ.ศ.</option>{Array.from({length: maxYear - 1858 + 1}, (_, i) => maxYear - i).map(y => <option key={y} value={y}>{y + 543}</option>)}</select>
    </div>
    {invalid && <small role="alert">วันที่อยู่นอกช่วงที่เลือกได้</small>}
  </div>;
}
