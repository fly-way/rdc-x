import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.js';
import { FileService } from '../src/files.js';
import { DocumentService } from '../src/documents.js';
import { NetworkService } from '../src/network.js';
import { Approvals } from '../src/approvals.js';
import { UnityService } from '../src/unity.js';
import { ProcessService } from '../src/processes.js';
import { SearchService } from '../src/search.js';
import { SystemService } from '../src/system.js';

await test('expanded capabilities', async t => {
  await t.test('session trust bypasses approvals only for that in-memory authorization', async () => {
    const f=fixture();
    try {
      const approvals=new Approvals(f.state); let ran=0;
      assert.equal(await approvals.run('grant-a','write_file',{path:'x'},async()=>++ran,true),1);
      approvals.setMode('grant-b','default');
      const pending:any=await approvals.run('grant-b','write_file',{path:'y'},async()=>++ran,true);
      assert.equal(pending.status,'approval_required'); assert.equal(ran,1);
      const strict:any=await approvals.run('grant-a','set_config_value',{key:'roots'},async()=>++ran,true,false);
      assert.equal(strict.status,'approval_required'); assert.equal(ran,1);
      assert.equal(approvals.mode('grant-a'),'trusted'); assert.equal(approvals.mode('grant-b'),'default');
      approvals.resetSessionTrust(); assert.equal(approvals.mode('grant-b'),'trusted');
    } finally { f.clean(); }
  });

  await t.test('PDF, Excel and DOCX services create, read and edit authorized documents', async () => {
    const f=fixture();
    try {
      const files=new FileService(f.state); const docs=new DocumentService(f.state,files.guard);
      await docs.writePdf('one.pdf','# One\nalpha');
      await docs.writePdf('two.pdf','# Two\nbeta');
      const merged:any=await docs.mergePdfs(['one.pdf','two.pdf'],'merged.pdf');
      assert.equal(merged.pages,2);
      const trimmed:any=await docs.deletePdfPages('merged.pdf','trimmed.pdf',[2]);
      assert.equal(trimmed.pages,1);
      const pdf:any=await docs.readPdf('trimmed.pdf',1,5);
      assert.equal(pdf.pageCount,1); assert.match(pdf.pages[0].text,/One|alpha/);
      const extracted:any=await docs.extractPdfPages('merged.pdf','extracted.pdf',[2,1]); assert.equal(extracted.pages,2);
      const inserted:any=await docs.insertPdf('one.pdf','two.pdf','inserted.pdf',1); assert.equal(inserted.pages,2);

      await docs.writeExcel('book.xlsx',[['Name','Value'],['A',1]],'Data');
      let excel:any=await docs.readExcel('book.xlsx','Data','A1:B2',10,10);
      assert.deepEqual(excel.rows,[['Name','Value'],['A',1]]);
      await docs.editExcel('book.xlsx','B2:B2',[[2]],'Data');
      excel=await docs.readExcel('book.xlsx','Data','A1:B2',10,10);
      assert.equal(excel.rows[1][1],2);

      await docs.writeDocx('note.docx','# Title\nHello World');
      let word:any=await docs.readDocx('note.docx'); assert.match(word.text,/Hello World/);
      const changed:any=await docs.editDocxText('note.docx','World','RDCX',1);
      assert.equal(changed.replacements,1);
      word=await docs.readDocx('note.docx'); assert.match(word.text,/Hello RDCX/);
    } finally { f.clean(); }
  });

  await t.test('hash, search wait, process wait and diagnostics form a reliable execution loop', async () => {
    const f=fixture();
    try {
      const files=new FileService(f.state);
      await fs.writeFile(path.join(f.workspace,'hash.txt'),'abc');
      const hashed:any=await files.hash('hash.txt','sha256',1024);
      assert.equal(hashed.digest,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

      await fs.writeFile(path.join(f.workspace,'search-me.txt'),'alpha\nbeta target\ngamma');
      const searches=new SearchService(files);
      const started=await searches.start('owner',{
        path:f.workspace,pattern:'target',type:'content',mode:'literal',ignoreCase:true,filePatterns:['*.txt'],
        includeHidden:false,includeGenerated:false,contextLines:1,maxDepth:4,maxResults:20,timeoutSeconds:5
      });
      const search:any=await searches.wait(started.searchId,'owner',5000,0,20);
      assert.notEqual(search.status,'running');
      assert.equal(search.totalResults,1);
      assert.match(search.results[0].content,/target/);

      f.state.config.terminalEnabled=true;
      const terminal=new ProcessService(f.state,files.guard);
      try {
        const command=process.platform==='win32'?"Write-Output 'wait-process-ok'":"printf 'wait-process-ok'";
        const session=await terminal.start('owner',command,f.workspace,10);
        const waited:any=await terminal.wait(session.sessionId,'owner',10000,0,20000);
        assert.notEqual(waited.state,'running');
        assert.match(waited.output,/wait-process-ok/);
      } finally {
        await terminal.stopAll();
        f.state.config.terminalEnabled=false;
      }

      const diagnostics:any=await new SystemService().diagnostics(f.state,f.base);
      assert.equal(diagnostics.roots[0].exists,true);
      assert.equal(diagnostics.roots[0].directory,true);
      assert.ok(Array.isArray(diagnostics.warnings));
      assert.ok(diagnostics.commands);
    } finally { f.clean(); }
  });

  await t.test('URL reader blocks loopback/private targets before any request', async () => {
    const network=new NetworkService();
    await assert.rejects(()=>network.read('http://127.0.0.1:65530/'),/private network/i);
    await assert.rejects(()=>network.read('http://localhost:65530/'),/private network/i);
    await assert.rejects(()=>network.read('file:///C:/Windows/win.ini'),/http\/https/i);
  });
  await t.test('Unity bridge installer includes object-level editor commands', async () => {
    const f=fixture();
    try {
      const project=path.join(f.workspace,'UnityProject');
      await fs.mkdir(path.join(project,'Assets'),{recursive:true});
      await fs.mkdir(path.join(project,'ProjectSettings'),{recursive:true});
      await fs.writeFile(path.join(project,'ProjectSettings','ProjectVersion.txt'),'m_EditorVersion: 2022.3.62f1\n');
      const files=new FileService(f.state); const unity=new UnityService(f.state,files.guard);
      const installed:any=await unity.installBridge(project);
      const source=await fs.readFile(installed.path,'utf8');
      for(const action of ['set_transform','create_game_object','delete_game_object','set_active','select_object','add_component','remove_component','serialized_properties','set_serialized_property','find_assets','instantiate_prefab','save_prefab','duplicate_game_object','unpack_prefab'])
        assert.match(source,new RegExp(action));
      const info:any=await unity.info(project); assert.equal(info.bridgeInstalled,true);
    } finally { f.clean(); }
  });
});
