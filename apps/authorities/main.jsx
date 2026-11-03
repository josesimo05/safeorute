import React from 'react';
import {createRoot} from 'react-dom/client';
import PilotApp from './PilotApp';
import './pilot.css';

// Independent visual prototype. It neither registers the citizen service
// worker nor connects to Firebase, cameras, or an institutional backend.
createRoot(document.getElementById('authority-root')).render(<PilotApp />);
