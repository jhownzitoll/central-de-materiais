export function siteUrl() { const configured = import.meta.env.VITE_SITE_URL?.trim(); if (configured) return configured.replace(/\/$/, ''); return window.location.origin }
