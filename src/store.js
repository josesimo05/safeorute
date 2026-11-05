import {initializeApp} from 'firebase/app';
import {getAuth,signInAnonymously,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,onAuthStateChanged,sendEmailVerification,GoogleAuthProvider,signInWithPopup} from 'firebase/auth';
import {getFirestore,collection,query,where,onSnapshot,doc,writeBatch,serverTimestamp,runTransaction} from 'firebase/firestore';
import {initializeAppCheck,ReCaptchaV3Provider} from 'firebase/app-check';
import {seed} from './logic';
import {firebaseSettings} from './firebase-config';
import {submitGuestReport} from './guest-identity-client';
import {eligibleModerator, moderatorIsActive, createReportReviewer, createReportWithdrawer} from './report-review';
const e=import.meta.env;
const settings=firebaseSettings(e);
export let cloud=settings.cloud;
export const demoMode=settings.mode==='demo';
export let configurationError=settings.configurationError;
let db,auth;
if(cloud){
  try {
    const app=initializeApp(settings.config);
    auth=getAuth(app);db=getFirestore(app);
    if(e.VITE_FIREBASE_APPCHECK_SITE_KEY)initializeAppCheck(app,{provider:new ReCaptchaV3Provider(e.VITE_FIREBASE_APPCHECK_SITE_KEY),isTokenAutoRefreshEnabled:true});
  }catch{
    cloud=false;configurationError='firebase/initialization-failed';
  }
}
const failure=code=>Object.assign(new Error(code),{code});
const noop=()=>{};
function requireCloud(){if(!cloud)throw failure(configurationError||'firebase/not-configured');}
function requireDemo(){if(!demoMode)throw failure(configurationError||'firebase/demo-only');}
const key='saferoute-demo-v1';
export function localRows(){if(!demoMode)return [];try{const s=localStorage.getItem(key);return s?JSON.parse(s):seed();}catch{return seed();}}
export function watch(onRows,onError=noop){
  if(demoMode){
    onRows(localRows());
    const changed=event=>{if(event.key===key||event.key===null)onRows(localRows());};
    window.addEventListener('storage',changed);
    return ()=>window.removeEventListener('storage',changed);
  }
  if(!cloud){onRows([]);onError(failure(configurationError||'firebase/not-configured'));return noop;}
  return onSnapshot(query(collection(db,'reports'),where('status','==','approved')),s=>onRows(s.docs.map(d=>({id:d.id,...d.data()}))),onError);
}
export function watchUser(callback){if(!cloud){callback(null);return ()=>{};}return onAuthStateChanged(auth,callback);}
export async function register(email,password){requireCloud();const credential=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(credential.user);return credential.user;}
export async function login(email,password){requireCloud();return (await signInWithEmailAndPassword(auth,email,password)).user;}
export async function loginWithGmail(){
  requireCloud();
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  return (await signInWithPopup(auth,provider)).user;
}
export async function logout(){if(cloud)await signOut(auth);}
export async function submit(r, {cedula, useGuestIdentity = false} = {}) {
  if (demoMode) {
    const rows = localRows();
    rows.unshift({...r, id:crypto.randomUUID(), status:'pending', source:'simulated', createdAt:new Date().toISOString()});
    localStorage.setItem(key, JSON.stringify(rows));
    return rows;
  }
  requireCloud();
  if (!auth.currentUser) await signInAnonymously(auth);
  if (useGuestIdentity) {
    const token = await auth.currentUser.getIdToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      await submitGuestReport({report:r, cedula, token, signal:controller.signal});
      return null;
    } finally {clearTimeout(timer);}
  }
  const ref = doc(collection(db, 'reports'));
  const batch = writeBatch(db);
  batch.set(ref, {...r, status:'pending', source:'community', createdAt:serverTimestamp()});
  batch.set(doc(db, 'submissionLimits', auth.currentUser.uid), {at:serverTimestamp(), lastReport:ref.id});
  await batch.commit();
  return null;
}
export function moderate(id,status){requireDemo();const rows=localRows().map(r=>r.id===id?{...r,status}:r);localStorage.setItem(key,JSON.stringify(rows));return rows;}
export function reset(){requireDemo();localStorage.removeItem(key);return seed();}

export function watchModerator(onFlag,onError=noop){
  let disposed=false,stopMembership=noop,generation=0;
  onFlag(false);
  if(!cloud){if(configurationError)onError(failure(configurationError));return noop;}
  const stopAuth=onAuthStateChanged(auth,user=>{
    const activeGeneration=++generation;
    stopMembership();stopMembership=noop;onFlag(false);
    if(!eligibleModerator(user))return;
    stopMembership=onSnapshot(doc(db,'reportModerators',user.uid),snapshot=>{
      if(!disposed&&generation===activeGeneration)onFlag(auth.currentUser?.uid===user.uid&&moderatorIsActive(auth.currentUser,snapshot.exists()?snapshot.data():null));
    },()=>{
      if(!disposed&&generation===activeGeneration){onFlag(false);onError(failure('moderation/role-unavailable'));}
    });
  },()=>{if(!disposed){stopMembership();onFlag(false);onError(failure('moderation/role-unavailable'));}});
  return ()=>{disposed=true;generation++;stopMembership();stopAuth();};
}

export function watchReviewQueue(onRows,onError=noop){
  if(!cloud||!eligibleModerator(auth.currentUser)){
    onRows([]);onError(failure(configurationError||'moderation/not-authorized'));return noop;
  }
  return onSnapshot(query(collection(db,'reports'),where('status','==','pending')),snapshot=>{
    onRows(snapshot.docs.map(document=>({id:document.id,...document.data()})));
  },error=>{onRows([]);onError(failure(error?.code||'moderation/queue-unavailable'));});
}

export async function reviewReport(reportId,nextStatus){
  requireCloud();
  const review=createReportReviewer({
    currentUser:()=>auth.currentUser,
    reference:(name,id)=>doc(db,name,id),
    transaction:operation=>runTransaction(db,operation),
    timestamp:serverTimestamp,
  });
  return review(reportId,nextStatus);
}
export async function withdrawReport(reportId){
  requireCloud();
  const withdraw=createReportWithdrawer({
    currentUser:()=>auth.currentUser,
    reference:(name,id)=>doc(db,name,id),
    transaction:operation=>runTransaction(db,operation),
    timestamp:serverTimestamp,
  });
  return withdraw(reportId);
}
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
