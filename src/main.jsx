import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {LocaleProvider} from './LocaleContext';
import 'leaflet/dist/leaflet.css';
import './style.css';

createRoot(document.getElementById('root')).render(<LocaleProvider><App/></LocaleProvider>);
