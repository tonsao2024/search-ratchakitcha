# ราชค้น · Ratcha Search

React + Vite + Express สำหรับค้นประกาศแต่งตั้งและประกาศเกี่ยวกับ ป.ป.ช.

```sh
npm install
npm run dev     # UI :5173, API :3001 ผ่าน Vite proxy /api
npm test
npm run build
npm start      # production :3001 ให้บริการ UI และ API
```

## ข้อมูลจริง — ไม่มีข้อมูลจำลองในแอป

- เปิดเว็บแล้วโหลดเดือนปัจจุบันอัตโนมัติ เลือกเดือนอื่นจากช่อง “โหลดข้อมูลเดือน” แล้วกดโหลด/รีเฟรช
- `/api/search?month=2026-09` คืนข้อมูลจริงที่แคชไว้ ถ้าไม่มีจะดาวน์โหลด `meta/2026/2026-09.jsonl` จาก Hugging Face โดยตรง ไม่พึ่ง search index สำหรับการแสดงรายการ
- `&refresh=1` ดาวน์โหลดไฟล์เดือนนั้นใหม่ อ่านครบทุกบรรทัด ตัดรายการ `is_test` และคัดหมวดจากชื่อประกาศ ก่อนเก็บแคช `.cache/YYYY-MM.json` แบบ atomic
- ถ้า API เชื่อมต่อ upstream ไม่ได้ เบราว์เซอร์จะลองดาวน์โหลดไฟล์สาธารณะเดียวกันโดยตรง (ขึ้นกับเครือข่าย/CORS ของต้นทาง)
- เซิร์ฟเวอร์ลองซิงก์เดือนปัจจุบันทุก 24 ชั่วโมง **เฉพาะขณะที่ process เปิดทำงาน** ไม่ใช่ managed cron service
- วันที่/เดือนในช่องเลือกใช้ ค.ศ. รายการแสดงวันที่ พ.ศ.

### สถานะที่ตรวจสอบได้ในสภาพแวดล้อมพัฒนา

เครื่องมืออ่านเว็บเข้าถึง Hugging Face ได้ แต่การเชื่อมต่อ HTTPS จาก Node/curl ใน sandbox นี้ล้มเหลว จึงยังทดสอบ successful live monthly sync จริงจากเซิร์ฟเวอร์ไม่ได้

`data/verified-snapshot.json` เป็นสำเนา **5 ประกาศจริง** จากไฟล์ `meta/2026/2026-09.jsonl` ที่อ่านได้เมื่อ 24 กันยายน 2026 (web reader chunks 199 และ 207) ชื่อเรื่อง วันที่ เล่ม ตอน และ URL PDF มาจากต้นทาง ไม่ได้สร้างข้อมูลประกาศขึ้นเอง:

- แต่งตั้งกรรมการอื่นในคณะกรรมการการไฟฟ้าส่วนภูมิภาค — 132337.pdf
- พระราชทานยศและแต่งตั้งข้าราชการในพระองค์ฝ่ายทหาร — 132410.pdf
- พระราชทานยศและแต่งตั้งข้าราชการในพระองค์ฝ่ายตำรวจ — 132412.pdf
- แต่งตั้งข้าราชการตุลาการ — 131698.pdf
- แต่งตั้งข้าราชการอัยการ — 132340.pdf

สำเนานี้ **ไม่ครบเดือนและยังไม่มีรายการ ป.ป.ช.** ไม่สามารถสรุปได้ว่าไม่มีประกาศ ป.ป.ช. ในเดือนนี้ UI ระบุ “สำเนาบางส่วน ไม่ครบเดือน” และไม่แสดงสถานะเชื่อมต่อสดสำเร็จ หาก API/เบราว์เซอร์ดาวน์โหลดไฟล์เต็มได้ จะใช้รายการทั้งหมดที่คัดกรองจากไฟล์เดือนนั้นแทน สำเนาขนาดเล็กนี้เก็บใน Git เพื่อให้เปิดเว็บแล้วแสดงข้อมูลจริงได้ ส่วนแคชดาวน์โหลดขนาดใหญ่ไม่เก็บใน Git

เวลา `connectedAt` มีเฉพาะเมื่อแอปโหลดต้นทางสำเร็จ ส่วนสำเนาเริ่มต้นมีเพียง `retrievedOn` และ `connectedAt: null` ไม่ปลอมเวลาเชื่อมต่อ

## OCR และขอบเขตการค้นหา

Metadata ไม่มีเนื้อหา PDF จึงไม่เติมข้อความจำลองให้เอกสาร เมื่อเลือก “เนื้อหาในไฟล์” แล้วค้น จะเรียก `/api/ocr-search?q=...` ไป Dataset Viewer config `openlawdata` (สูงสุด 100 ผลต่อคำค้น) และจับคู่ข้อความกับ ID ของประกาศที่โหลดไว้เท่านั้น ถ้าบริการ OCR ใช้ไม่ได้ จะแจ้งเตือนให้เปิด PDF ต้นฉบับ ไม่อ้างว่าค้นเนื้อหาได้สำเร็จ

ตัวกรองวัน/หมวดย่อย/AND/OR/วลี/NOT/หน่วยงาน และ sorting ใช้กับ **ข้อมูลที่โหลดแล้ว** ไม่ใช่ฐานทุกปี การจำแนกหมวดเป็นกฎคำสำคัญ ไม่ใช่ taxonomy ที่รับรองจากต้นทาง สำหรับค้นทั้งฐานควรนำเข้า metadata/OCR และทำ Thai search index ฝั่ง server

## ที่มาและสัญญาอนุญาต

[Open Law Data Thailand · soc-ratchakitcha](https://huggingface.co/datasets/open-law-data-thailand/soc-ratchakitcha) ข้อมูลจากสำนักเลขาธิการคณะรัฐมนตรี · CC BY 4.0

ปรับรูปแบบ field เพื่อแสดงผลและจำแนกหมวดโดยแอป ควรตรวจสอบ PDF ราชกิจจานุเบกษาต้นฉบับก่อนอ้างอิงทางกฎหมาย

Theme และรายการบันทึกเก็บใน localStorage ของ browser ไม่ใช่บัญชีข้ามอุปกรณ์

## GitHub Pages: real data deployment

The Pages build uses **static JSON generated from the actual Hugging Face dataset**, not the five-record emergency snapshot or Express endpoints. `npm run sync:data`:

1. Resolves a dataset revision and lists all metadata months in the current year (`DATA_YEAR` overrides the year).
2. Downloads each complete monthly metadata file and filters appointments / NACC notices.
3. Streams the matching monthly `ocr/openlawdata-ocr` file and joins valid OCR text by document ID / PDF filename. Missing OCR is reported separately; no text is fabricated.
4. Writes `public/data/YYYY-MM.json` and a manifest recording revision, counts, OCR coverage, and real sync timestamps.
5. CI builds with `VITE_STATIC_DATA=true` and `VITE_BASE_PATH=/search-ratchakitcha/`. Pages loads only project-relative static JSON; all filters and OCR search operate on the imported records. By default it loads every imported month of the current year.

Generated data lives in Actions/Pages artifacts, not Git. A metadata fetch failure prevents publication; the previously deployed site stays intact. An OCR fetch failure is logged and published as reduced OCR coverage. The refresh button reloads the latest published dataset, **not** a new Actions run.

### Required repository settings

- Settings → Pages → Source: **GitHub Actions**
- Settings → Environments → github-pages → Deployment branches: allow **arena/01a0d240-search-ratchakitcha**
- Workflow: `.github/workflows/pages.yml`, triggered by pushes to the session branch or manual workflow dispatch.
- The daily schedule is configured for **06:15 Asia/Bangkok**, but GitHub only activates scheduled workflows once the workflow file is present on the default branch. Merge the PR to enable the schedule. Checkout/deployment remains pinned to the session branch; do not delete that branch while this workflow is in use. GitHub scheduled execution can be delayed.
- No Hugging Face token is needed for this public dataset.

Local static build after a successful sync:

```sh
npm run sync:data
VITE_STATIC_DATA=true VITE_BASE_PATH=/search-ratchakitcha/ npm run build
```

The supplied GitHub integration can push code and start Actions, but initial attempts to update Pages settings or environment branch policies returned HTTP 403. A repository administrator must apply those settings before deployment can finish.
