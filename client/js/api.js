/**
 * api.js — Centralised API client
 * All calls go to THIS server's /api/* endpoints.
 * No external API URLs, no keys, no Supabase URLs in the frontend.
 */

const API = {
  // Retrieve stored session token
  _token() {
    return sessionStorage.getItem('ib_token') || '';
  },

  // Core fetch wrapper — attaches Bearer token automatically
  async _fetch(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    const token = this._token();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },

  // ── Auth ────────────────────────────────────────────────────────
  async login(email, password) {
    const data = await this._fetch('/auth/login', {
      method: 'POST',
      body:   { email, password },
    });
    // Store token in sessionStorage (cleared when tab closes)
    sessionStorage.setItem('ib_token',  data.session.access_token);
    sessionStorage.setItem('ib_doctor', JSON.stringify(data.doctor));
    return data;
  },

  async logout() {
    try {
      await this._fetch('/auth/logout', { method: 'POST' });
    } catch (_) {
      // Always clear local state even if server call fails
    }
    sessionStorage.clear();
  },

  getDoctor() {
    const raw = sessionStorage.getItem('ib_doctor');
    return raw ? JSON.parse(raw) : null;
  },

  isLoggedIn() {
    return !!(this._token() && this.getDoctor());
  },

  // ── Patients ─────────────────────────────────────────────────────
  async getPatients() {
    return this._fetch('/patients');
  },

  // ── Billing ──────────────────────────────────────────────────────
  async extractCodes(transcript) {
    return this._fetch('/billing/extract', {
      method: 'POST',
      body:   { transcript },
    });
  },

  async submitBilling(payload) {
    return this._fetch('/billing/submit', {
      method: 'POST',
      body:   payload,
    });
  },

  async getRecentBillings(limit = 8) {
    return this._fetch(`/billing/recent?limit=${limit}`);
  },

  // ── Admin ────────────────────────────────────────────────────────
  async getDoctors() {
    return this._fetch('/admin/doctors');
  },

  async createDoctor(payload) {
    return this._fetch('/admin/doctors', { method: 'POST', body: payload });
  },

  async updateDoctor(id, payload) {
    return this._fetch(`/admin/doctors/${id}`, { method: 'PATCH', body: payload });
  },

  async deleteDoctor(id) {
    return this._fetch(`/admin/doctors/${id}`, { method: 'DELETE' });
  },

  // ── Admin auth (separate endpoint — no doctors row required) ─────
  async adminLogin(email, password) {
    const data = await this._fetch('/auth/admin-login', {
      method: 'POST',
      body:   { email, password },
    });
    // Store admin token in sessionStorage
    sessionStorage.setItem('ib_token',   data.session.access_token);
    sessionStorage.setItem('ib_isAdmin', 'true');
    return data;
  },
};

window.API = API;
