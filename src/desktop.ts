import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { State } from './state.js';

const execFileAsync=promisify(execFile);
const ps=async(script:string)=>execFileAsync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[Text.Encoding]::UTF8; '+script],{maxBuffer:8*1024*1024,windowsHide:true});

export class DesktopService {
  constructor(private state:State){}
  private windowsOnly(){ if(process.platform!=='win32') throw new Error('Desktop tools currently require Windows.'); }
  private assertPoint(x:number,y:number){ if(!Number.isInteger(x)||!Number.isInteger(y)||x < -32768||y < -32768||x > 32767||y > 32767) throw new Error('Invalid screen coordinates.'); }
  private async capture(script:string){
    this.windowsOnly(); const target=path.join(this.state.dataDir,'desktop-'+Date.now()+'-'+Math.random().toString(16).slice(2)+'.png');
    const esc=target.replace(/'/g,"''"); await ps(script.replaceAll('__TARGET__',esc));
    const data=await fs.readFile(target); await fs.unlink(target).catch(()=>{});
    return { content:[{type:'image' as const,mimeType:'image/png',data:data.toString('base64')}] };
  }
  async listDisplays(){
    this.windowsOnly();
    const {stdout}=await ps("Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding=[Text.Encoding]::UTF8; @([Windows.Forms.Screen]::AllScreens | ForEach-Object {[pscustomobject]@{DeviceName=$_.DeviceName;Primary=$_.Primary;X=$_.Bounds.X;Y=$_.Bounds.Y;Width=$_.Bounds.Width;Height=$_.Bounds.Height;WorkingX=$_.WorkingArea.X;WorkingY=$_.WorkingArea.Y;WorkingWidth=$_.WorkingArea.Width;WorkingHeight=$_.WorkingArea.Height;BitsPerPixel=$_.BitsPerPixel}}) | ConvertTo-Json -Compress");
    const value=stdout.trim()?JSON.parse(stdout):[]; return { displays:Array.isArray(value)?value:[value] };
  }
  async screenshot(display=0){
    this.windowsOnly(); if(!Number.isInteger(display)||display<0||display>31) throw new Error('Invalid display index.');
    return this.capture(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $screens=@([Windows.Forms.Screen]::AllScreens); if(${display} -ge $screens.Count){throw 'Display index out of range'}; $b=$screens[${display}].Bounds; $i=New-Object Drawing.Bitmap $b.Width,$b.Height; $g=[Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.X,$b.Y,0,0,$b.Size); $i.Save('__TARGET__',[Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $i.Dispose()`);
  }
  async screenshotRegion(x:number,y:number,width:number,height:number){
    this.assertPoint(x,y); if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000||width*height>50000000) throw new Error('Invalid capture size.');
    return this.capture(`Add-Type -AssemblyName System.Drawing; $i=New-Object Drawing.Bitmap ${width},${height}; $g=[Drawing.Graphics]::FromImage($i); $g.CopyFromScreen(${x},${y},0,0,$i.Size); $i.Save('__TARGET__',[Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $i.Dispose()`);
  }
  async screenshotWindow(pid:number){
    this.windowsOnly(); if(!Number.isInteger(pid)||pid<=0) throw new Error('Invalid PID.');
    return this.capture(`Add-Type -AssemblyName System.Drawing; Add-Type @'
using System; using System.Runtime.InteropServices;
public struct RDCXRect { public int Left,Top,Right,Bottom; }
public class RDCXWindow { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd,out RDCXRect rect); }
'@; $p=Get-Process -Id ${pid} -ErrorAction Stop; if($p.MainWindowHandle -eq 0){throw 'Process has no main window'}; $r=New-Object RDCXRect; if(-not [RDCXWindow]::GetWindowRect($p.MainWindowHandle,[ref]$r)){throw 'GetWindowRect failed'}; $w=$r.Right-$r.Left; $h=$r.Bottom-$r.Top; if($w -lt 1 -or $h -lt 1){throw 'Window has invalid bounds'}; $i=New-Object Drawing.Bitmap $w,$h; $g=[Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($r.Left,$r.Top,0,0,$i.Size); $i.Save('__TARGET__',[Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $i.Dispose()`);
  }
  async listWindows(){
    this.windowsOnly(); const {stdout}=await ps("Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object Id,ProcessName,MainWindowTitle,MainWindowHandle | ConvertTo-Json -Compress");
    const value=stdout.trim()?JSON.parse(stdout):[]; return { windows:Array.isArray(value)?value:[value] };
  }
  async getWindowInfo(pid:number){
    this.windowsOnly(); if(!Number.isInteger(pid)||pid<=0) throw new Error('Invalid PID.');
    const {stdout}=await ps(`Add-Type @'
using System; using System.Runtime.InteropServices;
public struct RDCXRectInfo { public int Left,Top,Right,Bottom; }
public class RDCXWindowInfo { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd,out RDCXRectInfo rect); }
'@; $p=Get-Process -Id ${pid} -ErrorAction Stop; if($p.MainWindowHandle -eq 0){throw 'Process has no main window'}; $r=New-Object RDCXRectInfo; if(-not [RDCXWindowInfo]::GetWindowRect($p.MainWindowHandle,[ref]$r)){throw 'GetWindowRect failed'}; [pscustomobject]@{Id=$p.Id;ProcessName=$p.ProcessName;Title=$p.MainWindowTitle;Handle=[int64]$p.MainWindowHandle;X=$r.Left;Y=$r.Top;Width=$r.Right-$r.Left;Height=$r.Bottom-$r.Top}|ConvertTo-Json -Compress`);
    return JSON.parse(stdout.trim());
  }

  async focusWindow(pid:number){
    this.windowsOnly(); const script=`Add-Type @'
using System; using System.Runtime.InteropServices; public class W {[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);}
'@; $p=Get-Process -Id ${pid} -ErrorAction Stop; if($p.MainWindowHandle -eq 0){throw 'Process has no main window'}; [W]::SetForegroundWindow($p.MainWindowHandle)|Out-Null`;
    await ps(script); return {pid,focused:true};
  }
  async getCursor(){
    this.windowsOnly(); const {stdout}=await ps(`Add-Type @'
using System; using System.Runtime.InteropServices; public struct P {public int X; public int Y;} public class C {[DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);}
'@; $p=New-Object P; [C]::GetCursorPos([ref]$p)|Out-Null; [pscustomobject]@{x=$p.X;y=$p.Y}|ConvertTo-Json -Compress`);
    return JSON.parse(stdout.trim());
  }
  async sendKeys(keys:string){
    this.windowsOnly(); if(keys.length>2000) throw new Error('Key sequence too long.'); const encoded=Buffer.from(keys,'utf16le').toString('base64');
    await ps(`Add-Type -AssemblyName System.Windows.Forms; $s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); [System.Windows.Forms.SendKeys]::SendWait($s)`);
    return {sent:true,characters:keys.length};
  }
  async moveMouse(x:number,y:number){
    this.windowsOnly(); this.assertPoint(x,y); await ps(`Add-Type @'
using System; using System.Runtime.InteropServices; public class CursorMove {[DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y);}
'@; [CursorMove]::SetCursorPos(${x},${y})|Out-Null`); return {x,y,moved:true};
  }
  async click(x:number,y:number,button:'left'|'right'='left'){
    this.windowsOnly(); this.assertPoint(x,y); const flag=button==='left'?'0x0002,0x0004':'0x0008,0x0010';
    await ps(`Add-Type @'
using System; using System.Runtime.InteropServices; public class M {[DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);}
'@; [M]::SetCursorPos(${x},${y})|Out-Null; [M]::mouse_event(${flag.split(',')[0]},0,0,0,[UIntPtr]::Zero); [M]::mouse_event(${flag.split(',')[1]},0,0,0,[UIntPtr]::Zero)`); return {x,y,button,clicked:true};
  }
  async doubleClick(x:number,y:number,button:'left'|'right'='left'){ await this.click(x,y,button); await new Promise(r=>setTimeout(r,80)); await this.click(x,y,button); return {x,y,button,doubleClicked:true}; }
  async scroll(delta:number,x?:number,y?:number){
    this.windowsOnly(); if(!Number.isInteger(delta)||delta < -12000||delta > 12000||delta===0) throw new Error('Invalid wheel delta.');
    if(x!==undefined&&y!==undefined) await this.moveMouse(x,y);
    await ps(`Add-Type @'
using System; using System.Runtime.InteropServices; public class MW {[DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,int d,UIntPtr e);}
'@; [MW]::mouse_event(0x0800,0,0,${delta},[UIntPtr]::Zero)`); return {delta,scrolled:true};
  }
  async readClipboard(){ this.windowsOnly(); const {stdout}=await ps("Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding=[Text.Encoding]::UTF8; [Windows.Forms.Clipboard]::GetText()"); return { text:stdout.replace(/\r?\n$/,'') }; }
  async setClipboard(text:string){
    this.windowsOnly(); if(text.length>200000) throw new Error('Clipboard text is too large.'); const encoded=Buffer.from(text,'utf16le').toString('base64');
    await ps(`Add-Type -AssemblyName System.Windows.Forms; $s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); [Windows.Forms.Clipboard]::SetText($s)`); return {characters:text.length};
  }
  async typeText(text:string){
    this.windowsOnly(); if(text.length>20000) throw new Error('Text is too long.'); const encoded=Buffer.from(text,'utf16le').toString('base64');
    await ps(`Add-Type -AssemblyName System.Windows.Forms; $old=[Windows.Forms.Clipboard]::GetText(); try {$s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); [Windows.Forms.Clipboard]::SetText($s); [Windows.Forms.SendKeys]::SendWait('^v'); Start-Sleep -Milliseconds 80} finally {if($old){[Windows.Forms.Clipboard]::SetText($old)}else{[Windows.Forms.Clipboard]::Clear()}}`); return {typed:true,characters:text.length};
  }
}
