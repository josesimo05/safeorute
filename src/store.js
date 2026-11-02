import {initializeApp} from 'firebase/app';
import {getAuth,signInAnonymously,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,onAuthStateChanged,sendEmailVerification} from 'firebase/auth';
import {getFirestore,collection,query,where,onSnapshot,doc,writeBatch,serverTimestamp} from 'firebase/firestore';
import {initializeAppCheck,ReCaptchaV3Provider} from 'firebase/app-check';
import {seed} from './logic';
import {firebaseSettings} from './firebase-config';
const e=import.meta.env;
const settings=firebaseSettings(e);
export const cloud=settings.cloud;
let db,auth;
if(cloud){const app=initializeApp(settings.config);if(e.VITE_FIREBASE_APPCHECK_SITE_KEY)initializeAppCheck(app,{provider:new ReCaptchaV3Provider(e.VITE_FIREBASE_APPCHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});db=getFirestore(app);auth=getAuth(app);}
const key='saferoute-demo-v1';
export function localRows(){try{const s=localStorage.getItem(key);return s?JSON.parse(s):seed();}catch{return seed();}}
export function watch(onRows,onError){if(!cloud){onRows(localRows());return ()=>{};}return onSnapshot(query(collection(db,'reports'),where('status','==','approved')),s=>onRows(s.docs.map(d=>({id:d.id,...d.data()}))),onError);}
export function watchUser(callback){if(!cloud){callback(null);return ()=>{};}return onAuthStateChanged(auth,callback);}
export async function register(email,password){if(!cloud)throw new Error('Conecta Firebase para crear cuentas reales.');const credential=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(credential.user);return credential.user;}
export async function login(email,password){if(!cloud)throw new Error('Conecta Firebase para iniciar sesión.');return (await signInWithEmailAndPassword(auth,email,password)).user;}
export async function logout(){if(cloud)await signOut(auth);}
export async function submit(r){if(!cloud){const rows=localRows();rows.unshift({...r,id:crypto.randomUUID(),status:'pending',source:'simulated',createdAt:new Date().toISOString()});localStorage.setItem(key,JSON.stringify(rows));return rows;}if(!auth.currentUser)await signInAnonymously(auth);const ref=doc(collection(db,'reports'));const batch=writeBatch(db);batch.set(ref,{...r,status:'pending',source:'community',createdAt:serverTimestamp()});batch.set(doc(db,'submissionLimits',auth.currentUser.uid),{at:serverTimestamp(),lastReport:ref.id});await batch.commit();return null;}
export function moderate(id,status){const rows=localRows().map(r=>r.id===id?{...r,status}:r);localStorage.setItem(key,JSON.stringify(rows));return rows;}
export function reset(){localStorage.removeItem(key);return seed();}
export async function analyze(description){if(!cloud)throw new Error('La API de IA requiere Firebase y una clave configurada en Vercel.');if(!auth.currentUser)await signInAnonymously(auth);const token=await auth.currentUser.getIdToken();const res=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({description})});if(!res.ok)throw new Error('No se pudo consultar la IA. Revisa la configuración o intenta luego.');return res.json();}

export async function askSupport({message,language,signal}) {
  const failure=(code,status)=>Object.assign(new Error(code),{code,status});
  const abort=()=>{if(signal?.aborted)throw new DOMException('Aborted','AbortError');};
  abort();
  if(!cloud)throw failure('SUPPORT_NOT_CONFIGURED',503);
  let token;
  try {
    if(!auth.currentUser)await signInAnonymously(auth);
    token=await auth.currentUser.getIdToken();
  }catch{abort();throw failure('SUPPORT_AUTH_UNAVAILABLE',401);}
  abort();
  let response;
  try {
    response=await fetch('/api/support',{method:'POST',signal,cache:'no-store',credentials:'omit',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({message,language})});
  }catch{abort();throw failure('SUPPORT_NETWORK_ERROR');}
  let body;
  try{body=await response.json();}catch{throw failure('SUPPORT_UNAVAILABLE',response.status);}
  if(!response.ok) {
    const codes=['SUPPORT_NOT_CONFIGURED','SUPPORT_AUTH_REQUIRED','SUPPORT_RATE_LIMIT','SUPPORT_UNAVAILABLE','SUPPORT_INVALID_REQUEST'];
    throw failure(codes.includes(body?.error)?body.error:'SUPPORT_UNAVAILABLE',response.status);
  }
  if(typeof body?.answer!=='string'||!Array.isArray(body.sourceIds)||typeof body.needsHuman!=='boolean')throw failure('SUPPORT_UNAVAILABLE',502);
  return body;
}
