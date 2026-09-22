import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Document as DocxDocument, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import type { State } from './state.js';
import type { PathGuard } from './paths.js';

function a1(cell: string) {
  const m = /^([A-Z]+)([1-9][0-9]*)$/i.exec(cell.trim());
  if (!m) throw new Error('Invalid Excel cell reference.');
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]!), col };
}
function rangeOf(value?: string) {
  if (!value) return null;
  const parts = value.split(':');
  const left = parts[0]!; const right = parts[1] ?? left;
  const a = a1(left), b = a1(right);
  return { r1: Math.min(a.row,b.row), r2: Math.max(a.row,b.row), c1: Math.min(a.col,b.col), c2: Math.max(a.col,b.col) };
}
function cellValue(value: any): any {
  if (value == null) return null;
  if (typeof value === 'object') {
    if ('result' in value) return (value as any).result;
    if ('text' in value) return (value as any).text;
    if ('richText' in value) return (value as any).richText.map((x:any)=>x.text).join('');
    if (value instanceof Date) return value.toISOString();
  }
  return value;
}
export class DocumentService {
  constructor(private state: State, private guard: PathGuard) {}
  private async file(input: string, write = false, allowMissing = false) {
    const target = await this.guard.resolve(input, write, allowMissing);
    if (!allowMissing) {
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error('Expected a regular file.');
      if (stat.size > Math.max(this.state.config.maxFileBytes, 25 * 1024 * 1024)) throw new Error('Document exceeds size limit.');
    }
    return target;
  }
  async readPdf(input: string, startPage = 1, pageCount = 20) {
    const target = await this.file(input);
    const bytes = await fs.readFile(target);
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false });
    const pdf = await task.promise;
    const pages: any[] = [];
    const end = Math.min(pdf.numPages, startPage + pageCount - 1);
    for (let n = Math.max(1,startPage); n <= end; n++) {
      const page = await pdf.getPage(n); const content = await page.getTextContent();
      pages.push({ page: n, text: content.items.map((x:any)=>x.str ?? '').join(' ').replace(/\s+/g,' ').trim() });
      page.cleanup();
    }
    await pdf.cleanup?.();
    await task.destroy?.();
    return { path: target, pageCount: pdf.numPages, pages, nextPage: end < pdf.numPages ? end + 1 : null };
  }
  async writePdf(input: string, text: string, title?: string) {
    const target = await this.file(input, true, true);
    await this.guard.resolve(path.dirname(target), true);
    const chunks: Buffer[] = [];
    const pdf = new PDFDocument({ size: 'A4', margin: 54, info: title ? { Title: title } : undefined });
    pdf.on('data', (c:Buffer)=>chunks.push(c));
    const done = new Promise<Buffer>((resolve,reject)=>{ pdf.on('end',()=>resolve(Buffer.concat(chunks))); pdf.on('error',reject); });
    if (title) pdf.fontSize(22).text(title).moveDown();
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('### ')) pdf.fontSize(14).text(line.slice(4)).moveDown(0.25);
      else if (line.startsWith('## ')) pdf.fontSize(17).text(line.slice(3)).moveDown(0.35);
      else if (line.startsWith('# ')) pdf.fontSize(20).text(line.slice(2)).moveDown(0.5);
      else if (line.startsWith('- ')) pdf.fontSize(11).text('• ' + line.slice(2), { indent: 12 });
      else pdf.fontSize(11).text(line || ' ');
    }
    pdf.end(); const data = await done;
    if (data.length > 25 * 1024 * 1024) throw new Error('Generated PDF is too large.');
    try { await fs.stat(target); throw new Error('Destination already exists. Choose a new PDF path.'); } catch (e:any) { if (e.code !== 'ENOENT') throw e; }
    await fs.writeFile(target, data, { flag: 'wx' });
    return { path: target, bytes: data.length };
  }
  async readExcel(input: string, sheet?: string, range?: string, maxRows = 200, maxCols = 50) {
    const target = await this.file(input); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(target);
    const ws = sheet ? (wb.getWorksheet(sheet) ?? wb.getWorksheet(Number(sheet)+1)) : wb.worksheets[0];
    if (!ws) throw new Error('Worksheet not found.');
    const r = rangeOf(range);
    const r1 = r?.r1 ?? 1, r2 = Math.min(r?.r2 ?? ws.rowCount, r1 + maxRows - 1);
    const c1 = r?.c1 ?? 1, c2 = Math.min(r?.c2 ?? Math.max(1,ws.columnCount), c1 + maxCols - 1);
    const rows:any[][] = [];
    for (let row=r1; row<=r2; row++) {
      const values:any[]=[]; for (let col=c1; col<=c2; col++) values.push(cellValue(ws.getCell(row,col).value));
      rows.push(values);
    }
    return { path: target, sheet: ws.name, range: { r1,r2,c1,c2 }, rows, sheets: wb.worksheets.map(s=>s.name) };
  }
  async writeExcel(input: string, rows: any[][], sheet='Sheet1') {
    const target = await this.file(input, true, true);
    try { await fs.stat(target); throw new Error('Destination already exists. Choose a new workbook path.'); } catch(e:any) { if (e.code !== 'ENOENT') throw e; }
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(sheet);
    for (const row of rows) ws.addRow(row);
    await wb.xlsx.writeFile(target); return { path: target, sheet, rows: rows.length };
  }
  async editExcel(input: string, range: string, rows: any[][], sheet?: string) {
    const target = await this.file(input, true); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(target);
    const ws = sheet ? (wb.getWorksheet(sheet) ?? wb.getWorksheet(Number(sheet)+1)) : wb.worksheets[0];
    if (!ws) throw new Error('Worksheet not found.');
    const r = rangeOf(range); if (!r) throw new Error('Range is required.');
    if (rows.length > (r.r2-r.r1+1) || rows.some(row=>row.length > (r.c2-r.c1+1))) throw new Error('Values exceed target range.');
    const backup = target + '.rdcx-backup-' + Date.now(); await fs.copyFile(target, backup);
    rows.forEach((values,ri)=>values.forEach((v,ci)=>{ ws.getCell(r.r1+ri,r.c1+ci).value=v; }));
    await wb.xlsx.writeFile(target); return { path: target, sheet: ws.name, range, backup };
  }
  async readDocx(input: string) {
    const target = await this.file(input); const result = await mammoth.extractRawText({ path: target });
    return { path: target, text: result.value, messages: result.messages.slice(0,20) };
  }
  async writeDocx(input: string, markdown: string) {
    const target = await this.file(input, true, true);
    try { await fs.stat(target); throw new Error('Destination already exists. Choose a new DOCX path.'); } catch(e:any) { if (e.code !== 'ENOENT') throw e; }
    const children = markdown.split(/\r?\n/).map(line => {
      let heading:any=undefined, value=line;
      if (line.startsWith('### ')) { heading=HeadingLevel.HEADING_3; value=line.slice(4); }
      else if (line.startsWith('## ')) { heading=HeadingLevel.HEADING_2; value=line.slice(3); }
      else if (line.startsWith('# ')) { heading=HeadingLevel.HEADING_1; value=line.slice(2); }
      return new Paragraph({ heading, children:[new TextRun(value)] });
    });
    const doc = new DocxDocument({ sections:[{ children }] }); const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(target, buffer, { flag:'wx' }); return { path: target, bytes: buffer.length };
  }
  async deletePdfPages(input:string, output:string, pages:number[]) {
    const source=await this.file(input); const target=await this.file(output,true,true);
    try { await fs.stat(target); throw new Error('Destination already exists.'); } catch(e:any) { if(e.code!=='ENOENT') throw e; }
    const pdf=await PDFLibDocument.load(await fs.readFile(source));
    const unique=[...new Set(pages)].sort((a,b)=>b-a);
    if(!unique.length) throw new Error('At least one page is required.');
    for(const page of unique) {
      if(!Number.isInteger(page)||page<1||page>pdf.getPageCount()) throw new Error('PDF page is out of range: '+page);
      pdf.removePage(page-1);
    }
    if(pdf.getPageCount()===0) throw new Error('Refusing to create a PDF with zero pages.');
    const data=await pdf.save(); await fs.writeFile(target,data,{flag:'wx'});
    return { path:target, pages:pdf.getPageCount(), removed:unique.slice().reverse() };
  }
  async extractPdfPages(input:string, output:string, pages:number[]) {
    const source=await this.file(input); const target=await this.file(output,true,true);
    try { await fs.stat(target); throw new Error('Destination already exists.'); } catch(e:any) { if(e.code!=='ENOENT') throw e; }
    const pdf=await PDFLibDocument.load(await fs.readFile(source));
    const ordered=[...new Set(pages)];
    if(!ordered.length) throw new Error('At least one page is required.');
    for(const page of ordered) if(!Number.isInteger(page)||page<1||page>pdf.getPageCount()) throw new Error('PDF page is out of range: '+page);
    const result=await PDFLibDocument.create();
    const copied=await result.copyPages(pdf,ordered.map(page=>page-1)); for(const page of copied) result.addPage(page);
    const data=await result.save(); await fs.writeFile(target,data,{flag:'wx'});
    return { path:target, pages:result.getPageCount(), extracted:ordered };
  }
  async insertPdf(input:string, insertInput:string, output:string, afterPage:number) {
    const source=await this.file(input); const insertedSource=await this.file(insertInput); const target=await this.file(output,true,true);
    try { await fs.stat(target); throw new Error('Destination already exists.'); } catch(e:any) { if(e.code!=='ENOENT') throw e; }
    const base=await PDFLibDocument.load(await fs.readFile(source)); const insert=await PDFLibDocument.load(await fs.readFile(insertedSource));
    if(!Number.isInteger(afterPage)||afterPage<0||afterPage>base.getPageCount()) throw new Error('afterPage must be between 0 and the base PDF page count.');
    const result=await PDFLibDocument.create();
    const beforeIndices=Array.from({length:afterPage},(_,i)=>i); const afterIndices=Array.from({length:base.getPageCount()-afterPage},(_,i)=>i+afterPage);
    for(const page of await result.copyPages(base,beforeIndices)) result.addPage(page);
    for(const page of await result.copyPages(insert,insert.getPageIndices())) result.addPage(page);
    for(const page of await result.copyPages(base,afterIndices)) result.addPage(page);
    const data=await result.save(); await fs.writeFile(target,data,{flag:'wx'});
    return { path:target, pages:result.getPageCount(), insertedPages:insert.getPageCount(), afterPage };
  }
  async mergePdfs(inputs:string[], output:string) {
    if(inputs.length<1||inputs.length>20) throw new Error('Provide 1-20 source PDFs.');
    const target=await this.file(output,true,true);
    try { await fs.stat(target); throw new Error('Destination already exists.'); } catch(e:any) { if(e.code!=='ENOENT') throw e; }
    const merged=await PDFLibDocument.create(); const sources:string[]=[];
    for(const input of inputs) {
      const source=await this.file(input); const pdf=await PDFLibDocument.load(await fs.readFile(source));
      const copied=await merged.copyPages(pdf,pdf.getPageIndices()); for(const page of copied) merged.addPage(page); sources.push(source);
    }
    const data=await merged.save(); await fs.writeFile(target,data,{flag:'wx'});
    return { path:target, pages:merged.getPageCount(), sources };
  }
  async editDocxText(input:string, oldText:string, newText:string, expected=1) {
    if(!oldText) throw new Error('oldText cannot be empty.');
    const target=await this.file(input,true); const zip=await JSZip.loadAsync(await fs.readFile(target));
    const names=Object.keys(zip.files).filter(n=>/^word\/(document|header\d+|footer\d+)\.xml$/i.test(n));
    let count=0; const docs=new Map<string,any>();
    for(const name of names) {
      const xml=await zip.file(name)!.async('string'); const doc=new DOMParser().parseFromString(xml,'application/xml'); docs.set(name,doc);
      const paragraphs:any[]=Array.from(doc.getElementsByTagName('w:p') as any);
      for(const para of paragraphs) {
        const text=(Array.from(para.getElementsByTagName('w:t') as any) as any[]).map(n=>n.textContent??'').join('');
        let at=0; while((at=text.indexOf(oldText,at))>=0){count++;at+=oldText.length;}
      }
    }
    if(count!==expected) throw new Error(`Expected ${expected} DOCX text matches but found ${count}.`);
    for(const [name,doc] of docs) {
      for(const para of (Array.from(doc.getElementsByTagName('w:p') as any) as any[])) {
        const nodes:any[]=Array.from(para.getElementsByTagName('w:t') as any); let text=nodes.map(n=>n.textContent??'').join('');
        const hits:number[]=[]; let at=0; while((at=text.indexOf(oldText,at))>=0){hits.push(at);at+=oldText.length;}
        for(const start of hits.reverse()) {
          let pos=0, si=-1, ei=-1, so=0, eo=0; const end=start+oldText.length;
          for(let i=0;i<nodes.length;i++){const value=nodes[i]!.textContent??'', next=pos+value.length;
            if(si<0 && start>=pos && start<next){si=i;so=start-pos;} if(end>pos && end<=next){ei=i;eo=end-pos;break;} pos=next;}
          if(si<0||ei<0) throw new Error('DOCX run mapping failed.');
          if(si===ei){const v=nodes[si]!.textContent??'';nodes[si]!.textContent=v.slice(0,so)+newText+v.slice(eo);}
          else {const left=nodes[si]!.textContent??'', right=nodes[ei]!.textContent??'';nodes[si]!.textContent=left.slice(0,so)+newText;for(let i=si+1;i<ei;i++)nodes[i]!.textContent='';nodes[ei]!.textContent=right.slice(eo);}
        }
      }
      zip.file(name,new XMLSerializer().serializeToString(doc));
    }
    const backup=target+'.rdcx-backup-'+Date.now(); await fs.copyFile(target,backup);
    const data=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}); await fs.writeFile(target,data);
    return { path:target, replacements:count, backup };
  }
}
