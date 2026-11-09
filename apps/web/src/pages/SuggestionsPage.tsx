import { useEffect,useState } from "react";
import { api,ApiError } from "../api";
type Suggestion={id:string;category:string;title:string;description:string;status:string;votes:number;voted:number;mine:number;author_user_id:string|null;created_at:number};
const statuses=["new","planned","in_progress","completed","declined"];
export function SuggestionsPage(){
 const [items,setItems]=useState<Suggestion[]>([]),[admin,setAdmin]=useState(false),[sort,setSort]=useState("popular");
 const [category,setCategory]=useState("feature"),[title,setTitle]=useState(""),[description,setDescription]=useState("");
 const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const [editing,setEditing]=useState<string|null>(null);
 async function load(){const r=await api<{suggestions:Suggestion[];admin:boolean}>("/api/suggestions");setItems(r.suggestions);setAdmin(r.admin)}
 useEffect(()=>{void load().catch(e=>setError(e instanceof ApiError?e.message:"Could not load suggestions."))},[]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");
 try{await api("/api/suggestions",{method:"POST",body:JSON.stringify({category,title,description})});setTitle("");setDescription("");setMessage("Suggestion shared with the team.");await load()}
 catch(e){setError(e instanceof ApiError?e.message:"Could not submit suggestion.")}finally{setBusy(false)}}
 async function vote(id:string){setError("");try{await api("/api/suggestions/"+encodeURIComponent(id)+"/vote",{method:"POST"});await load()}catch(e){setError(e instanceof ApiError?e.message:"Could not vote.")}}
 async function update(id:string,body:Record<string,string>){setError("");try{await api("/api/suggestions/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(body)});setEditing(null);await load()}catch(e){setError(e instanceof ApiError?e.message:"Could not update suggestion.")}}
 const ordered=[...items].sort((a,b)=>sort==="popular"?Number(b.votes)-Number(a.votes)||b.created_at-a.created_at:b.created_at-a.created_at);
 return <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
  <h1 className="font-heading text-2xl font-semibold">Team Suggestions</h1>
  <p className="text-quiet">Share improvements, report bugs, and vote on ideas. Ideas are visible to the team; authors are private.</p>
  {error?<p role="alert" className="error-banner">{error}</p>:null}{message?<p role="status">{message}</p>:null}
  <form onSubmit={e=>void submit(e)} className="panel flex flex-col gap-s2">
   <h2 className="font-heading font-semibold">Share an idea</h2>
   <label className="field">Type<select value={category} onChange={e=>setCategory(e.target.value)}><option value="feature">New feature</option><option value="improvement">Improvement</option><option value="bug">Bug report</option></select></label>
   <label className="field">Title<input required minLength={3} maxLength={100} value={title} onChange={e=>setTitle(e.target.value)} placeholder="What would you like to see?"/></label>
   <label className="field">Details<textarea maxLength={2000} rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="How would this help?"/></label>
   <button className="save-workout" disabled={busy||title.trim().length<3} type="submit">{busy?"Submitting…":"Submit suggestion"}</button>
  </form>
  <div className="flex items-center justify-between"><h2 className="font-heading font-semibold">Team ideas ({items.length})</h2><label className="text-sm">Sort <select value={sort} onChange={e=>setSort(e.target.value)}><option value="popular">Most votes</option><option value="newest">Newest</option></select></label></div>
  {ordered.length===0?<p className="text-quiet">No suggestions yet. Be the first!</p>:null}
  {ordered.map(s=><section key={s.id} className="panel flex flex-col gap-s2">
   <div className="flex items-start gap-s2"><button type="button" className="secondary-button" aria-label={s.voted?"Remove vote":"Upvote"} aria-pressed={!!s.voted} onClick={()=>void vote(s.id)}><span aria-hidden="true">▲</span> {s.votes}</button><div className="min-w-0 flex-1"><h3 className="font-heading font-semibold">{s.title}</h3><p className="text-xs text-quiet">{s.category.replace("_"," ")} · {s.status.replace("_"," ")} · {new Date(s.created_at).toLocaleDateString()}</p></div></div>
   <p className="whitespace-pre-wrap break-words text-sm">{s.description}</p>
   {admin?<label className="field">Status<select value={s.status} onChange={e=>void update(s.id,{status:e.target.value})}>{statuses.map(status=><option key={status} value={status}>{status.replace("_"," ")}</option>)}</select></label>:null}
   {s.mine&&s.status==="new"?(editing===s.id?<EditSuggestion item={s} onCancel={()=>setEditing(null)} onSave={body=>void update(s.id,body)}/>:<button type="button" className="secondary-button" onClick={()=>setEditing(s.id)}>Edit my suggestion</button>):null}
  </section>)}
 </main>
}
function EditSuggestion({item,onCancel,onSave}:{item:Suggestion;onCancel:()=>void;onSave:(body:{title:string;description:string})=>void}){
 const [title,setTitle]=useState(item.title),[description,setDescription]=useState(item.description);
 return <form className="flex flex-col gap-s1" onSubmit={e=>{e.preventDefault();onSave({title,description})}}>
 <label className="field">Title<input required minLength={3} maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label className="field">Details<textarea maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 <div className="flex gap-s1"><button type="submit" className="secondary-button">Save</button><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button></div>
 </form>
}
