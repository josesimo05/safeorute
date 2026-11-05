import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ReportReviewPanel from '../../src/ReportReviewPanel';
import {LocaleProvider} from '../../src/LocaleContext';
import '../../src/style.css';

// Test-only callbacks deliberately contain no Firebase, tokens or persistence.
// The production Vite inputs do not reference this page or module.
const sample = {
  category:'Otro', description:'Obstáculo ficticio junto al cruce de prueba.',
  lat:18.476, lng:-69.943, occurredAt:'2026-01-01T10:00:00.000Z',
};
const fixture = window.__moderationFixture = {
  calls:[], hold:false, fail:false, release:null,
};

function Fixture() {
  const [reports, setReports] = useState([{...sample, id:'pending-one', status:'pending'}]);
  const [published, setPublished] = useState([
    {...sample, id:'published-one', status:'approved', description:'Reporte publicado de prueba número uno.'},
    {...sample, id:'published-two', status:'approved', description:'Reporte publicado de prueba número dos.'},
    {...sample, id:'pending-in-published', status:'pending', description:'Este pendiente no debe aparecer entre los publicados.'},
    {...sample, id:'already-withdrawn', status:'withdrawn', description:'Este retirado tampoco debe aparecer entre los publicados.'},
  ]);
  async function review(id, status) {
    fixture.calls.push({action:'review', id, status});
    setReports(rows => rows.filter(row => row.id !== id));
    if (status === 'approved') setPublished(rows => [...rows, {...sample, id, status}]);
  }
  async function withdraw(id) {
    fixture.calls.push({action:'withdraw', id});
    if (fixture.hold) await new Promise(resolve => {fixture.release = resolve;});
    if (fixture.fail) throw Object.assign(new Error('private-test-token-must-not-be-displayed'), {code:'test/unknown-error'});
    setPublished(rows => rows.filter(row => row.id !== id));
  }
  return <div style={{width:'min(100%, 460px)', marginInline:'auto', padding:16}}>
    <ReportReviewPanel reports={reports} approvedReports={published} onReview={review} onWithdraw={withdraw} />
  </div>;
}

// Keep a single root when Vite reloads a dependency during local development.
const container = document.getElementById('root');
const root = container.__moderationTestRoot || createRoot(container);
container.__moderationTestRoot = root;
root.render(<LocaleProvider><Fixture /></LocaleProvider>);
