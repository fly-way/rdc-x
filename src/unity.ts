import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { random, type State } from './state.js';
import type { PathGuard } from './paths.js';

const bridgeSource = String.raw`#if UNITY_EDITOR
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;
using System;
using System.IO;
using System.Collections.Generic;
using System.Globalization;

[InitializeOnLoad]
public static class RDCXBridge {
  [Serializable] class Request { public string id; public string action; public string argument; }
  [Serializable] class Response { public string id; public bool ok; public string message; public string dataJson; }
  [Serializable] class NodeInfo { public string path; public string name; public bool active; public int layer; public string tag; }
  [Serializable] class NodeList { public List<NodeInfo> items = new List<NodeInfo>(); }
  [Serializable] class StringList { public List<string> items = new List<string>(); }
  [Serializable] class SceneData { public string name; public string path; public bool dirty; }
  [Serializable] class TransformPayload { public string path; public float[] position; public float[] rotation; public float[] scale; }
  [Serializable] class CreatePayload { public string name; public string parent; }
  [Serializable] class BoolPayload { public string path; public bool value; }
  [Serializable] class ComponentPayload { public string path; public string type; }
  [Serializable] class PropertyPayload { public string path; public string component; public string property; public string value; }
  [Serializable] class PropertyInfo { public string path; public string type; public string value; public bool editable; }
  [Serializable] class PropertyList { public List<PropertyInfo> items = new List<PropertyInfo>(); }
  [Serializable] class AssetSearchPayload { public string filter; public string[] folders; public int limit; }
  [Serializable] class PrefabPayload { public string assetPath; public string parent; public string name; }
  [Serializable] class PrefabSavePayload { public string path; public string assetPath; }
  [Serializable] class DuplicatePayload { public string path; public string parent; public string name; }
  [Serializable] class UnpackPayload { public string path; public bool completely; }
  [Serializable] class PathData { public string path; }
  static string Dir => Path.Combine(Directory.GetParent(Application.dataPath).FullName, "Library", "RDCX");
  static string RequestFile => Path.Combine(Dir, "request.json");
  static string ResponseFile => Path.Combine(Dir, "response.json");
  static RDCXBridge() { Directory.CreateDirectory(Dir); EditorApplication.update += Tick; }
  static void Tick() {
    if (!File.Exists(RequestFile)) return;
    string raw;
    try { raw = File.ReadAllText(RequestFile); File.Delete(RequestFile); } catch { return; }
    Request req = null; try { req = JsonUtility.FromJson<Request>(raw); } catch {}
    if (req == null || String.IsNullOrEmpty(req.id)) return;
    var res = new Response { id=req.id, ok=true, message="ok", dataJson="" };
    try {
      switch(req.action) {
        case "hierarchy": res.dataJson = Hierarchy(); break;
        case "active_scene": res.dataJson = JsonUtility.ToJson(new SceneData { name=SceneManager.GetActiveScene().name, path=SceneManager.GetActiveScene().path, dirty=SceneManager.GetActiveScene().isDirty }); break;
        case "enter_play_mode": EditorApplication.isPlaying = true; res.message="Play Mode requested"; break;
        case "exit_play_mode": EditorApplication.isPlaying = false; res.message="Exit Play Mode requested"; break;
        case "open_scene": EditorSceneManager.OpenScene(req.argument); res.message="Scene opened"; break;
        case "save_scene": if(!EditorSceneManager.SaveOpenScenes()) throw new Exception("SaveOpenScenes returned false"); res.message="Scenes saved"; break;
        case "execute_menu": if(!EditorApplication.ExecuteMenuItem(req.argument)) throw new Exception("Menu item was not executed: "+req.argument); res.message="Menu executed"; break;
        case "screenshot_game_view": var p=Path.Combine(Dir,"game-"+DateTime.Now.Ticks+".png"); ScreenCapture.CaptureScreenshot(p); res.message=p; break;
        case "selection": res.dataJson = SelectionData(); break;
        case "components": res.dataJson = Components(req.argument); break;
        case "set_transform": SetTransform(JsonUtility.FromJson<TransformPayload>(req.argument)); res.message="Transform updated"; break;
        case "create_game_object": res.dataJson = CreateObject(JsonUtility.FromJson<CreatePayload>(req.argument)); break;
        case "delete_game_object": DeleteObject(req.argument); res.message="GameObject deleted"; break;
        case "set_active": SetActive(JsonUtility.FromJson<BoolPayload>(req.argument)); res.message="Active state updated"; break;
        case "select_object": SelectObject(req.argument); res.message="Object selected"; break;
        case "add_component": AddComponent(JsonUtility.FromJson<ComponentPayload>(req.argument)); res.message="Component added"; break;
        case "remove_component": RemoveComponent(JsonUtility.FromJson<ComponentPayload>(req.argument)); res.message="Component removed"; break;
        case "serialized_properties": res.dataJson = SerializedProperties(JsonUtility.FromJson<ComponentPayload>(req.argument)); break;
        case "set_serialized_property": SetSerializedProperty(JsonUtility.FromJson<PropertyPayload>(req.argument)); res.message="Serialized property updated"; break;
        case "find_assets": res.dataJson = FindAssets(JsonUtility.FromJson<AssetSearchPayload>(req.argument)); break;
        case "instantiate_prefab": res.dataJson = InstantiatePrefab(JsonUtility.FromJson<PrefabPayload>(req.argument)); break;
        case "save_prefab": res.dataJson = SavePrefab(JsonUtility.FromJson<PrefabSavePayload>(req.argument)); break;
        case "duplicate_game_object": res.dataJson = DuplicateObject(JsonUtility.FromJson<DuplicatePayload>(req.argument)); break;
        case "unpack_prefab": UnpackPrefab(JsonUtility.FromJson<UnpackPayload>(req.argument)); res.message="Prefab unpacked"; break;
        default: throw new Exception("Unknown action: "+req.action);
      }
    } catch(Exception e) { res.ok=false; res.message=e.ToString(); }
    try { File.WriteAllText(ResponseFile, JsonUtility.ToJson(res)); } catch {}
  }
  static string Hierarchy() {
    var result = new NodeList();
    foreach(var root in SceneManager.GetActiveScene().GetRootGameObjects()) Walk(root.transform, "", result.items);
    return JsonUtility.ToJson(result);
  }
  static void Walk(Transform t, string parent, List<NodeInfo> output) {
    string p = String.IsNullOrEmpty(parent) ? t.name : parent + "/" + t.name;
    output.Add(new NodeInfo { path=p, name=t.name, active=t.gameObject.activeInHierarchy, layer=t.gameObject.layer, tag=t.gameObject.tag });
    for(int i=0;i<t.childCount;i++) Walk(t.GetChild(i),p,output);
  }
  static GameObject FindObject(string objectPath) {
    if(String.IsNullOrEmpty(objectPath)) throw new Exception("Object path is required");
    var parts=objectPath.Split('/'); GameObject current=null;
    foreach(var root in SceneManager.GetActiveScene().GetRootGameObjects()) if(root.name==parts[0]) { current=root; break; }
    if(current==null) throw new Exception("GameObject not found: "+objectPath);
    Transform t=current.transform;
    for(int i=1;i<parts.Length;i++) { Transform next=t.Find(parts[i]); if(next==null) throw new Exception("GameObject not found: "+objectPath); t=next; }
    return t.gameObject;
  }
  static string ObjectPath(Transform t) {
    var names=new List<string>(); while(t!=null){names.Add(t.name);t=t.parent;} names.Reverse(); return String.Join("/",names.ToArray());
  }
  static string SelectionData() {
    var go=Selection.activeGameObject; return JsonUtility.ToJson(new PathData { path=go==null?"":ObjectPath(go.transform) });
  }
  static string Components(string objectPath) {
    var go=FindObject(objectPath); var result=new StringList();
    foreach(var c in go.GetComponents<Component>()) if(c!=null) result.items.Add(c.GetType().FullName);
    return JsonUtility.ToJson(result);
  }
  static void SetTransform(TransformPayload p) {
    if(p==null) throw new Exception("Invalid transform payload"); var go=FindObject(p.path); Undo.RecordObject(go.transform,"RDC-X transform");
    if(p.position!=null&&p.position.Length==3) go.transform.localPosition=new Vector3(p.position[0],p.position[1],p.position[2]);
    if(p.rotation!=null&&p.rotation.Length==3) go.transform.localEulerAngles=new Vector3(p.rotation[0],p.rotation[1],p.rotation[2]);
    if(p.scale!=null&&p.scale.Length==3) go.transform.localScale=new Vector3(p.scale[0],p.scale[1],p.scale[2]);
    EditorUtility.SetDirty(go.transform); EditorSceneManager.MarkSceneDirty(go.scene);
  }
  static string CreateObject(CreatePayload p) {
    if(p==null||String.IsNullOrWhiteSpace(p.name)) throw new Exception("Object name is required");
    var go=new GameObject(p.name); Undo.RegisterCreatedObjectUndo(go,"RDC-X create GameObject");
    if(!String.IsNullOrEmpty(p.parent)) go.transform.SetParent(FindObject(p.parent).transform,false);
    Selection.activeGameObject=go; EditorSceneManager.MarkSceneDirty(go.scene);
    return JsonUtility.ToJson(new PathData { path=ObjectPath(go.transform) });
  }
  static void DeleteObject(string objectPath) {
    var go=FindObject(objectPath); var scene=go.scene; Undo.DestroyObjectImmediate(go); EditorSceneManager.MarkSceneDirty(scene);
  }
  static void SetActive(BoolPayload p) {
    if(p==null) throw new Exception("Invalid active-state payload"); var go=FindObject(p.path); Undo.RecordObject(go,"RDC-X active state"); go.SetActive(p.value); EditorUtility.SetDirty(go); EditorSceneManager.MarkSceneDirty(go.scene);
  }
  static void SelectObject(string objectPath) { var go=FindObject(objectPath); Selection.activeGameObject=go; EditorGUIUtility.PingObject(go); }
  static void AddComponent(ComponentPayload p) {
    if(p==null||String.IsNullOrWhiteSpace(p.type)) throw new Exception("Component type is required"); var go=FindObject(p.path); Type found=null;
    foreach(var asm in AppDomain.CurrentDomain.GetAssemblies()) {
      found=asm.GetType(p.type,false,true); if(found!=null) break;
      try { foreach(var candidate in asm.GetTypes()) if(String.Equals(candidate.Name,p.type,StringComparison.OrdinalIgnoreCase)){found=candidate;break;} } catch {}
      if(found!=null) break;
    }
    if(found==null||!typeof(Component).IsAssignableFrom(found)||found==typeof(Transform)) throw new Exception("Component type not found or not addable: "+p.type);
    Undo.AddComponent(go,found); EditorSceneManager.MarkSceneDirty(go.scene);
  }
  static Component FindComponent(GameObject go, string typeName) {
    if(String.IsNullOrWhiteSpace(typeName)) throw new Exception("Component type is required");
    foreach(var c in go.GetComponents<Component>()) {
      if(c==null) continue; var t=c.GetType();
      if(String.Equals(t.FullName,typeName,StringComparison.OrdinalIgnoreCase)||String.Equals(t.Name,typeName,StringComparison.OrdinalIgnoreCase)) return c;
    }
    throw new Exception("Component not found: "+typeName);
  }
  static void RemoveComponent(ComponentPayload p) {
    if(p==null) throw new Exception("Invalid component payload"); var go=FindObject(p.path); var c=FindComponent(go,p.type);
    if(c is Transform) throw new Exception("Transform cannot be removed");
    Undo.DestroyObjectImmediate(c); EditorSceneManager.MarkSceneDirty(go.scene);
  }
  static string PropertyValue(SerializedProperty p) {
    switch(p.propertyType) {
      case SerializedPropertyType.Integer: return p.intValue.ToString(CultureInfo.InvariantCulture);
      case SerializedPropertyType.Boolean: return p.boolValue ? "true" : "false";
      case SerializedPropertyType.Float: return p.floatValue.ToString(CultureInfo.InvariantCulture);
      case SerializedPropertyType.String: return p.stringValue ?? "";
      case SerializedPropertyType.Enum: return p.enumValueIndex.ToString(CultureInfo.InvariantCulture);
      case SerializedPropertyType.ObjectReference:
        if(p.objectReferenceValue==null) return "";
        var asset=AssetDatabase.GetAssetPath(p.objectReferenceValue); return String.IsNullOrEmpty(asset)?p.objectReferenceValue.name:asset;
      case SerializedPropertyType.Vector2: var v2=p.vector2Value; return v2.x.ToString(CultureInfo.InvariantCulture)+","+v2.y.ToString(CultureInfo.InvariantCulture);
      case SerializedPropertyType.Vector3: var v3=p.vector3Value; return v3.x.ToString(CultureInfo.InvariantCulture)+","+v3.y.ToString(CultureInfo.InvariantCulture)+","+v3.z.ToString(CultureInfo.InvariantCulture);
      case SerializedPropertyType.Vector4: var v4=p.vector4Value; return v4.x.ToString(CultureInfo.InvariantCulture)+","+v4.y.ToString(CultureInfo.InvariantCulture)+","+v4.z.ToString(CultureInfo.InvariantCulture)+","+v4.w.ToString(CultureInfo.InvariantCulture);
      case SerializedPropertyType.Color: var c=p.colorValue; return c.r.ToString(CultureInfo.InvariantCulture)+","+c.g.ToString(CultureInfo.InvariantCulture)+","+c.b.ToString(CultureInfo.InvariantCulture)+","+c.a.ToString(CultureInfo.InvariantCulture);
      default: return "";
    }
  }
  static string SerializedProperties(ComponentPayload p) {
    if(p==null) throw new Exception("Invalid component payload"); var go=FindObject(p.path); var component=FindComponent(go,p.type);
    var so=new SerializedObject(component); var iterator=so.GetIterator(); var result=new PropertyList(); bool enter=true;
    while(iterator.NextVisible(enter)) {
      enter=false; result.items.Add(new PropertyInfo { path=iterator.propertyPath, type=iterator.propertyType.ToString(), value=PropertyValue(iterator), editable=iterator.propertyPath!="m_Script" });
    }
    return JsonUtility.ToJson(result);
  }
  static float ParseFloat(string value) { return Single.Parse(value,CultureInfo.InvariantCulture); }
  static float[] ParseNumbers(string value,int count) {
    var parts=(value??"").Split(','); if(parts.Length!=count) throw new Exception("Expected "+count+" comma-separated numbers");
    var values=new float[count]; for(int i=0;i<count;i++) values[i]=ParseFloat(parts[i]); return values;
  }
  static void SetSerializedProperty(PropertyPayload p) {
    if(p==null||String.IsNullOrWhiteSpace(p.property)) throw new Exception("Invalid property payload");
    var go=FindObject(p.path); var component=FindComponent(go,p.component); var so=new SerializedObject(component); so.Update();
    var prop=so.FindProperty(p.property); if(prop==null) throw new Exception("Serialized property not found: "+p.property);
    if(prop.propertyPath=="m_Script") throw new Exception("m_Script is read-only");
    Undo.RecordObject(component,"RDC-X property");
    switch(prop.propertyType) {
      case SerializedPropertyType.Integer: prop.intValue=Int32.Parse(p.value,CultureInfo.InvariantCulture); break;
      case SerializedPropertyType.Boolean: prop.boolValue=Boolean.Parse(p.value); break;
      case SerializedPropertyType.Float: prop.floatValue=ParseFloat(p.value); break;
      case SerializedPropertyType.String: prop.stringValue=p.value??""; break;
      case SerializedPropertyType.Enum: prop.enumValueIndex=Int32.Parse(p.value,CultureInfo.InvariantCulture); break;
      case SerializedPropertyType.Vector2: var v2=ParseNumbers(p.value,2); prop.vector2Value=new Vector2(v2[0],v2[1]); break;
      case SerializedPropertyType.Vector3: var v3=ParseNumbers(p.value,3); prop.vector3Value=new Vector3(v3[0],v3[1],v3[2]); break;
      case SerializedPropertyType.Vector4: var v4=ParseNumbers(p.value,4); prop.vector4Value=new Vector4(v4[0],v4[1],v4[2],v4[3]); break;
      case SerializedPropertyType.Color: var co=ParseNumbers(p.value,4); prop.colorValue=new Color(co[0],co[1],co[2],co[3]); break;
      case SerializedPropertyType.ObjectReference:
        if(String.IsNullOrWhiteSpace(p.value)) prop.objectReferenceValue=null;
        else if(p.value.StartsWith("Assets/")) prop.objectReferenceValue=AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(p.value);
        else prop.objectReferenceValue=FindObject(p.value);
        break;
      default: throw new Exception("Unsupported serialized property type: "+prop.propertyType);
    }
    so.ApplyModifiedProperties(); EditorUtility.SetDirty(component); EditorSceneManager.MarkSceneDirty(go.scene);
  }
  static string FindAssets(AssetSearchPayload p) {
    if(p==null) throw new Exception("Invalid asset search payload"); var limit=Mathf.Clamp(p.limit,1,500); string[] folders=p.folders;
    if(folders!=null) foreach(var f in folders) if(String.IsNullOrWhiteSpace(f)||!f.StartsWith("Assets")) throw new Exception("Asset search folders must be under Assets/");
    var guids=(folders!=null&&folders.Length>0)?AssetDatabase.FindAssets(p.filter??"",folders):AssetDatabase.FindAssets(p.filter??"");
    var result=new StringList(); for(int i=0;i<guids.Length&&result.items.Count<limit;i++) result.items.Add(AssetDatabase.GUIDToAssetPath(guids[i]));
    return JsonUtility.ToJson(result);
  }
  static string InstantiatePrefab(PrefabPayload p) {
    if(p==null||String.IsNullOrWhiteSpace(p.assetPath)||!p.assetPath.StartsWith("Assets/")) throw new Exception("A prefab Assets/ path is required");
    var asset=AssetDatabase.LoadAssetAtPath<GameObject>(p.assetPath); if(asset==null) throw new Exception("Prefab not found: "+p.assetPath);
    var go=(GameObject)PrefabUtility.InstantiatePrefab(asset); Undo.RegisterCreatedObjectUndo(go,"RDC-X instantiate prefab");
    if(!String.IsNullOrEmpty(p.parent)) go.transform.SetParent(FindObject(p.parent).transform,false);
    if(!String.IsNullOrWhiteSpace(p.name)) go.name=p.name; Selection.activeGameObject=go; EditorSceneManager.MarkSceneDirty(go.scene);
    return JsonUtility.ToJson(new PathData { path=ObjectPath(go.transform) });
  }
  static string SavePrefab(PrefabSavePayload p) {
    if(p==null||String.IsNullOrWhiteSpace(p.assetPath)||!p.assetPath.StartsWith("Assets/")||!p.assetPath.EndsWith(".prefab",StringComparison.OrdinalIgnoreCase)) throw new Exception("A destination Assets/*.prefab path is required");
    var go=FindObject(p.path); var projectRoot=Directory.GetParent(Application.dataPath).FullName; var absolute=Path.Combine(projectRoot,p.assetPath.Replace('/',Path.DirectorySeparatorChar));
    Directory.CreateDirectory(Path.GetDirectoryName(absolute)); bool success; var saved=PrefabUtility.SaveAsPrefabAssetAndConnect(go,p.assetPath,InteractionMode.UserAction,out success);
    if(!success||saved==null) throw new Exception("Prefab save failed"); AssetDatabase.SaveAssets();
    return JsonUtility.ToJson(new PathData { path=p.assetPath });
  }
  static string DuplicateObject(DuplicatePayload p) {
    if(p==null) throw new Exception("Invalid duplicate payload"); var source=FindObject(p.path); var go=UnityEngine.Object.Instantiate(source);
    Undo.RegisterCreatedObjectUndo(go,"RDC-X duplicate GameObject");
    if(!String.IsNullOrEmpty(p.parent)) go.transform.SetParent(FindObject(p.parent).transform,false); else go.transform.SetParent(source.transform.parent,false);
    go.name=String.IsNullOrWhiteSpace(p.name)?source.name+" Copy":p.name; Selection.activeGameObject=go; EditorSceneManager.MarkSceneDirty(go.scene);
    return JsonUtility.ToJson(new PathData { path=ObjectPath(go.transform) });
  }
  static void UnpackPrefab(UnpackPayload p) {
    if(p==null) throw new Exception("Invalid unpack payload"); var go=FindObject(p.path); var root=PrefabUtility.GetOutermostPrefabInstanceRoot(go);
    if(root==null) throw new Exception("GameObject is not part of a prefab instance");
    PrefabUtility.UnpackPrefabInstance(root,p.completely?PrefabUnpackMode.Completely:PrefabUnpackMode.OutermostRoot,InteractionMode.UserAction);
    EditorSceneManager.MarkSceneDirty(root.scene);
  }

}
#endif
`;

export class UnityService {
  constructor(private state:State, private guard:PathGuard){}
  private async project(input:string, write=false) {
    const root=await this.guard.resolve(input,write);
    const stat=await fs.stat(root); if(!stat.isDirectory()) throw new Error('Unity project path must be a directory.');
    await fs.access(path.join(root,'ProjectSettings','ProjectVersion.txt'));
    await fs.access(path.join(root,'Assets'));
    return root;
  }
  async listProjects() {
    const found:any[]=[];
    for (const root of this.state.config.roots) {
      const candidates=[root.path];
      try {
        for (const e of await fs.readdir(root.path,{withFileTypes:true})) if(e.isDirectory()) candidates.push(path.join(root.path,e.name));
      } catch {}
      for (const p of candidates) {
        try { await fs.access(path.join(p,'ProjectSettings','ProjectVersion.txt')); found.push(await this.info(p)); } catch {}
      }
    }
    return { projects:found.slice(0,100) };
  }
  async info(input:string) {
    const root=await this.project(input);
    const versionText=await fs.readFile(path.join(root,'ProjectSettings','ProjectVersion.txt'),'utf8');
    const version=/m_EditorVersion:\s*(.+)/.exec(versionText)?.[1]?.trim() ?? 'unknown';
    const packagesFile=path.join(root,'Packages','manifest.json'); let packages:any={};
    try { packages=JSON.parse(await fs.readFile(packagesFile,'utf8')).dependencies ?? {}; } catch {}
    return { path:root, name:path.basename(root), unityVersion:version, renderPipeline:Object.keys(packages).find(x=>/render-pipelines/.test(x)) ?? 'built-in', bridgeInstalled:fss.existsSync(path.join(root,'Assets','RDCX','Editor','RDCXBridge.cs')) };
  }
  async installBridge(input:string) {
    const root=await this.project(input,true); const dir=path.join(root,'Assets','RDCX','Editor'); await fs.mkdir(dir,{recursive:true});
    const target=path.join(dir,'RDCXBridge.cs');
    let backup:string|undefined;
    try { await fs.stat(target); backup=target+'.backup-'+Date.now(); await fs.copyFile(target,backup); } catch {}
    await fs.writeFile(target,bridgeSource,'utf8');
    return { path:target, backup, note:'Unity will compile the editor bridge automatically. Wait for script reload before sending commands.' };
  }
  async command(input:string, action:string, argument='', timeoutMs=12000) {
    const root=await this.project(input); const bridge=path.join(root,'Assets','RDCX','Editor','RDCXBridge.cs');
    if(!fss.existsSync(bridge)) throw new Error('RDC-X Unity bridge is not installed in this project.');
    const dir=path.join(root,'Library','RDCX'); await fs.mkdir(dir,{recursive:true});
    const requestFile=path.join(dir,'request.json'), responseFile=path.join(dir,'response.json'); const id=random(12);
    await fs.unlink(responseFile).catch(()=>{});
    await fs.writeFile(requestFile,JSON.stringify({id,action,argument}),'utf8');
    const deadline=Date.now()+Math.min(Math.max(timeoutMs,1000),30000);
    while(Date.now()<deadline) {
      await new Promise(r=>setTimeout(r,150));
      try {
        const res=JSON.parse(await fs.readFile(responseFile,'utf8'));
        if(res.id!==id) continue;
        await fs.unlink(responseFile).catch(()=>{});
        if(!res.ok) throw new Error(res.message || 'Unity command failed.');
        let data:any=res.dataJson; try { if(data) data=JSON.parse(data); } catch {}
        return { action, message:res.message, data };
      } catch(e:any) { if(e.code!=='ENOENT' && !String(e.message).includes('Unexpected end')) throw e; }
    }
    throw new Error('Unity editor did not answer. Ensure the project is open, scripts compiled, and the RDC-X bridge has no compile errors.');
  }
  async console(lines=200) {
    if(process.platform!=='win32') throw new Error('Unity console log lookup currently supports Windows.');
    const target=path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(),'AppData','Local'),'Unity','Editor','Editor.log');
    const raw=await fs.readFile(target,'utf8'); const all=raw.split(/\r?\n/);
    return { path:target, totalLines:all.length, lines:all.slice(-Math.min(lines,2000)) };
  }
  async screenshotGameView(input:string) {
    const result:any=await this.command(input,'screenshot_game_view'); const target=String(result.message||'');
    if(!target) throw new Error('Unity did not return a screenshot path.');
    const deadline=Date.now()+6000; let data:Buffer|undefined;
    while(Date.now()<deadline){try{data=await fs.readFile(target);break;}catch(e:any){if(e.code!=='ENOENT')throw e;await new Promise(r=>setTimeout(r,200));}}
    if(!data) throw new Error('Unity screenshot was not created in time.');
    await fs.unlink(target).catch(()=>{});
    return { content:[{type:'image' as const,mimeType:'image/png',data:data.toString('base64')}] };
  }
  async open(input:string) {
    const root=await this.project(input); const info=await this.info(root);
    if(process.platform!=='win32') throw new Error('Automatic Unity launch currently supports Windows.');
    const exe=path.join(process.env.ProgramFiles ?? 'C:\\Program Files','Unity','Hub','Editor',info.unityVersion,'Editor','Unity.exe');
    await fs.access(exe);
    const child=spawn(exe,['-projectPath',root],{detached:true,stdio:'ignore',windowsHide:false}); child.unref();
    return { project:root, unityVersion:info.unityVersion, pid:child.pid };
  }
}
