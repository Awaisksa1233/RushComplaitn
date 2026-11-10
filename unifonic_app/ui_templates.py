import json
from datetime import datetime, timezone
from typing import Dict, Any

def login_html() -> str:
    return """<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rush Wash &bull; WhatsApp Command Center &mdash; Sign in</title>
    <script>
        (function () {
            var t = 'light';
            try { t = localStorage.getItem('rw-theme') || 'light'; } catch (e) {}
            document.documentElement.setAttribute('data-theme', t);
        })();
        function rwToggleTheme() {
            var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', t);
            try { localStorage.setItem('rw-theme', t); } catch (e) {}
        }
    </script>
    <link rel="stylesheet" href="/static/brand/rushwash.css">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            position: relative;
        }
        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background: url('/static/brand/img/rush-bg-pattern.svg') center / cover no-repeat;
            opacity: .5;
            pointer-events: none;
        }
        .theme-slot { position: fixed; top: 16px; inset-inline-end: 16px; z-index: 2; }
        .login-card {
            position: relative;
            z-index: 1;
            width: 100%;
            max-width: 420px;
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-card);
            padding: 28px 21px 21px;
            display: flex;
            flex-direction: column;
            gap: 21px;
        }
        .brand-header { display: flex; flex-direction: column; gap: 7px; }
        .brand-logo { height: 28px; width: auto; align-self: flex-start; }
        .brand-title { font-size: 21px; line-height: 31.5px; font-weight: 500; color: var(--foreground); }
        .brand-sub { font-size: 12.25px; line-height: 18.38px; color: var(--muted-foreground); }
        .form-group { display: flex; flex-direction: column; gap: 7px; margin-bottom: 14px; }
        .form-label { font-size: 14px; line-height: 21px; font-weight: 500; color: var(--foreground); }
        .form-input {
            height: 31.5px;
            padding: 0 10.5px;
            font: inherit;
            font-size: 14px;
            border: 1px solid transparent;
            border-radius: var(--radius-md);
            width: 100%;
        }
        .btn-submit {
            width: 100%;
            height: 31.5px;
            margin-top: 7px;
            background: var(--primary);
            color: var(--primary-foreground);
            border: 0;
            border-radius: var(--radius-md);
            font: inherit;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background .15s;
        }
        .btn-submit:hover { background: rgb(var(--primary-hover-rgb)); }
        .btn-submit:disabled { opacity: .5; cursor: not-allowed; }
        .alert-error {
            display: none;
            padding: 10.5px;
            background: rgb(var(--destructive-rgb) / .06);
            border: 1px solid var(--destructive);
            border-radius: var(--radius-md);
            color: var(--destructive);
            font-size: 12.25px;
            line-height: 18.38px;
        }
        .footer-note { font-size: 10.5px; line-height: 15.75px; color: var(--muted-foreground); text-align: center; }
    </style>
</head>
<body>
    <div class="theme-slot">
        <button type="button" onclick="rwToggleTheme()" class="rw-theme-toggle" title="Toggle theme" aria-label="Toggle light / dark theme">
            <svg class="rw-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
            <svg class="rw-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        </button>
    </div>
    <div class="login-card">
        <div class="brand-header">
            <img class="brand-logo" src="/static/brand/img/rush-app-logo.svg" alt="Rush Wash">
            <h1 class="brand-title">WhatsApp Command Center</h1>
            <p class="brand-sub">Live chat, delivery reports and broadcasts for Rush Wash.</p>
        </div>

        <div id="error-alert" class="alert-error" role="alert"></div>

        <form id="login-form">
            <div class="form-group">
                <label class="form-label" for="username">Username</label>
                <input class="form-input" type="text" id="username" name="username" placeholder="admin" required autofocus>
            </div>
            <div class="form-group">
                <label class="form-label" for="password">Password</label>
                <input class="form-input" type="password" id="password" name="password" placeholder="Password" required>
            </div>
            <button type="submit" class="btn-submit" id="submit-btn">Sign in</button>
        </form>

        <div class="footer-note">
            Rush Wash &bull; Unifonic WhatsApp Business &bull; 2026
        </div>
    </div>

    <script>
        const form = document.getElementById('login-form');
        const errBox = document.getElementById('error-alert');
        const submitBtn = document.getElementById('submit-btn');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errBox.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.innerText = 'Signing in...';

            const username = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value;

            try {
                const res = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    window.location.href = data.redirect || '/';
                } else {
                    errBox.innerText = data.error || 'Invalid credentials. Please try again.';
                    errBox.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.innerText = 'Sign in';
                }
            } catch (err) {
                errBox.innerText = 'Connection error. Please try again.';
                errBox.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.innerText = 'Sign in';
            }
        });
    </script>
</body>
</html>"""


def full_solution_ui(public_https_url: str = "", unifonic_public_id: str = "", unifonic_channel_id: str = "") -> str:
    return """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RushWash &bull; WhatsApp Enterprise Command Center</title>
    <!-- Rush Wash design system -->
    <script>
        (function () {
            var t = 'light';
            try { t = localStorage.getItem('rw-theme') || 'light'; } catch (e) {}
            document.documentElement.setAttribute('data-theme', t);
            document.documentElement.classList.toggle('dark', t === 'dark');
        })();
        function rwVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
        window.addEventListener('rw-theme-change', function () {
            var el = document.querySelector('[x-data]');
            try { var d = window.Alpine && Alpine.$data(el); if (d && d.initCharts) d.initCharts(); } catch (e) {}
        });
        function rwToggleTheme() {
            var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', t);
            document.documentElement.classList.toggle('dark', t === 'dark');
            try { localStorage.setItem('rw-theme', t); } catch (e) {}
            window.dispatchEvent(new CustomEvent('rw-theme-change', { detail: t }));
        }
    </script>
    <link rel="stylesheet" href="/static/brand/rushwash.css">
    <!-- Tailwind CSS CDN -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: {
                extend: {
                    colors: {
                        wa: {
                            deep: 'rgb(var(--background-rgb) / <alpha-value>)',
                            panel: 'rgb(var(--card-rgb) / <alpha-value>)',
                            surface: 'rgb(var(--secondary-rgb) / <alpha-value>)',
                            border: 'rgb(var(--border-rgb) / <alpha-value>)',
                            green: 'rgb(var(--primary-rgb) / <alpha-value>)',
                            'green-bright': 'rgb(var(--primary-rgb) / <alpha-value>)',
                            text: 'rgb(var(--foreground-rgb) / <alpha-value>)',
                            muted: 'rgb(var(--muted-foreground-rgb) / <alpha-value>)',
                            bubble: {
                                in: 'rgb(var(--secondary-rgb) / <alpha-value>)',
                                out: 'rgb(var(--primary-rgb) / <alpha-value>)'
                            }
                        },
                        rush: {
                            red: 'rgb(var(--primary-rgb) / <alpha-value>)',
                            gold: '#d4af37'
                        }
                    },
                    fontFamily: {
                        sans: ['HelveticaNeueLTStd', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
                        arabic: ['Swissra', 'Cairo', 'Noto Sans Arabic', 'sans-serif'],
                        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
                    }
                }
            }
        }
    </script>
    <!-- Icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

    <!-- Dashboard Alpine Controller & State -->
    <script>
        function whatsappDashboard() {
            return {
                activeTab: 'analytics',
                isRefreshing: false,
                isLoadingTemplates: false,
                isUploadingMedia: false,
                searchQuery: '',
                chatSearch: '',
                dlrStatusFilter: 'ALL',
                dlrPhoneSearch: '',
                showNewCampaignModal: false,
                showCreateTemplateModal: false,
                createTemplateTab: 'form',
                isSubmittingTemplate: false,
                replyText: '',
                chatAttachmentUrl: '',

                // Template filtering
                templateStatusFilter: 'ALL',
                templateSearch: '',

                // Media Vault Picker
                showVaultPickerModal: false,
                vaultPickerContext: '',
                vaultSearchQuery: '',

                newTemplateForm: {
                    name: '',
                    category: 'MARKETING',
                    language: 'ar',
                    status: 'IN_REVIEW',
                    body: '',
                    mediaUrl: '',
                    buttonType: 'URL',
                    buttonText: '',
                    buttonUrl: ''
                },
                
                // Date Filter state
                datePreset: 'all',
                dateFrom: '',
                dateTo: '',
                trafficType: 'all',

                stats: {
                    total_sent: 0,
                    total_delivered: 0,
                    total_inbound: 0,
                    delivery_rate: 98.5,
                    active_24h_sessions: 0,
                    read_count: 0,
                    delivered_count: 0,
                    failed_count: 0,
                    total_cost: 0.0,
                    total_spent: 0.0,
                    cost_per_message: 0.15,
                    currency: 'SAR'
                },

                settingsForm: {
                    public_id: '',
                    secret_key: '',
                    channel_id: '',
                    cost_marketing: 0.15,
                    cost_utility: 0.04,
                    cost_auth: 0.035,
                    cost_service: 0.00,
                    currency: 'SAR',
                    https_webhook_url: '',
                    database: ''
                },
                isSavingSettings: false,

                campaigns: [],
                conversations: [],
                selectedConv: null,
                activeChatMessages: [],
                reports: [],
                filteredReports: [],
                templates: [],
                uploads: [],

                templateForm: {
                    name: '96_sar',
                    category: 'MARKETING',
                    language: 'ar',
                    body: 'عرض اليوم الوطني من رش واش!\\n\\nغسيل خارجي نانو لا محدود بـ 96 ريال شهريًا لأول شهرين بدلًا من 249 ريال. العرض للمشتركين الجدد ولفترة محدودة. اشترك الآن عبر rush.com.sa أو عبر مسار المبيعات.',
                    mediaUrl: '',
                    buttons: [{ type: 'URL', text: 'اشترك الآن', url: 'https://rush.com.sa/' }]
                },

                newCampaign: {
                    name: '',
                    rawNumbers: '',
                    template: '',
                    templateName: '',
                    templateLang: 'ar',
                    mediaUrl: '',
                    defaultVars: {}
                },

                // Ads & Attribution State (Snapchat & Meta)
                adsData: {
                    overview: {
                        total_spend_sar: 0,
                        total_impressions: 0,
                        total_clicks_swipes: 0,
                        blended_cpc_sar: 0,
                        total_wa_leads: 0,
                        blended_cost_per_lead_sar: 0,
                        total_conversions: 0,
                        blended_conversion_rate_pct: 0,
                        total_revenue_sar: 0,
                        blended_roas: 0,
                        last_synced_at: ''
                    },
                    platforms: {},
                    campaigns: [],
                    config_status: {}
                },
                isSyncingAds: false,
                adsPlatformFilter: 'ALL',
                adsSearch: '',
                showAdsSettingsModal: false,
                showAdsLinkModal: false,
                isSavingAdsSettings: false,
                adsSettingsForm: {
                    meta: { enabled: true, ad_account_id: '', access_token: '', status: '' },
                    snapchat: { enabled: true, ad_account_id: '', client_id: '', client_secret: '', refresh_token: '', status: '' },
                    whatsapp_business_phone: '966559421442'
                },
                adsLinkGen: {
                    platform: 'snapchat',
                    keyword: 'SNAP96',
                    custom_text: 'مرحباً رش واش، أود الاستفسار عن عرض اليوم الوطني 🚗',
                    result_url: ''
                },
                snapAuthCodeInput: '',

                // Smart Tracking Links State (rush.com.sa short links & visitor analytics)
                trackingLinksData: {
                    total_links: 0,
                    total_clicks: 0,
                    total_unique: 0,
                    links: []
                },
                isCreatingLink: false,
                editingLinkSlug: null,
                showCreateLinkModal: false,
                showLinkStatsModal: false,
                showQrModal: false,
                activeLinkStats: null,
                activeQrUrl: '',
                activeQrTitle: '',
                newLinkForm: {
                    title: '',
                    destination_url: 'https://rush.com.sa/en',
                    slug: '',
                    platform: 'snapchat',
                    status: 'ACTIVE',
                    utm_source: 'snapchat',
                    utm_medium: 'cpc',
                    utm_campaign: '',
                    utm_content: '',
                    utm_term: ''
                },

                trafficChartInstance: null,
                donutChartInstance: null,

                switchTab(tab) {
                    this.activeTab = tab;
                    if (tab === 'ads') {
                        this.loadAdsPerformance();
                    } else if (tab === 'links') {
                        this.loadTrackingLinks();
                    }
                },

                async initDashboard() {
                    try { await this.loadSettings(); } catch(e) { console.warn('loadSettings error:', e); }
                    try { await this.loadAllData(); } catch(e) { console.warn('loadAllData error:', e); }
                    try { await this.loadTemplates(false); } catch(e) { console.warn('loadTemplates error:', e); }
                    try { await this.loadUploads(); } catch(e) { console.warn('loadUploads error:', e); }
                    try { await this.loadAdsPerformance(); } catch(e) { console.warn('loadAdsPerformance error:', e); }
                    try { await this.loadAdsSettings(); } catch(e) { console.warn('loadAdsSettings error:', e); }
                    try { this.initCharts(); } catch(e) { console.warn('initCharts error:', e); }
                    try { this.startEventSource(); } catch(e) { console.warn('startEventSource error:', e); }
                },

                async loadSettings() {
                    try {
                        const r = await fetch('/api/settings');
                        if (r.ok) {
                            const data = await r.json();
                            this.settingsForm = {
                                public_id: data.public_id || '',
                                secret_key: data.is_secret_set ? '••••••••••••••••' : '',
                                channel_id: data.channel_id || '',
                                cost_marketing: data.cost_marketing || 0.15,
                                cost_utility: data.cost_utility || 0.04,
                                cost_auth: data.cost_auth || 0.035,
                                cost_service: data.cost_service || 0.00,
                                currency: data.currency || 'SAR',
                                https_webhook_url: data.https_webhook_url || '',
                                database: data.database || ''
                            };
                            if (data.currency) this.stats.currency = data.currency;
                            if (data.cost_marketing) this.stats.cost_per_message = data.cost_marketing;
                        }
                    } catch(e) {
                        console.warn('Error loading settings:', e);
                    }
                },

                async saveSettings() {
                    this.isSavingSettings = true;
                    try {
                        const payload = {
                            cost_marketing: parseFloat(this.settingsForm.cost_marketing),
                            cost_utility: parseFloat(this.settingsForm.cost_utility),
                            cost_auth: parseFloat(this.settingsForm.cost_auth),
                            cost_service: parseFloat(this.settingsForm.cost_service || 0),
                            currency: this.settingsForm.currency
                        };
                        if (this.settingsForm.public_id) payload.public_id = this.settingsForm.public_id;
                        if (this.settingsForm.secret_key && !this.settingsForm.secret_key.includes('•')) payload.secret_key = this.settingsForm.secret_key;
                        if (this.settingsForm.channel_id) payload.channel_id = this.settingsForm.channel_id;

                        const res = await fetch('/api/settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const d = await res.json();
                        if (d.status === 'success') {
                            alert('Pricing rates and settings saved successfully!');
                            await this.loadAllData();
                        } else {
                            alert('Error saving settings: ' + (d.error || 'Failed'));
                        }
                    } catch (e) {
                        alert('Failed to save settings: ' + e);
                    } finally {
                        this.isSavingSettings = false;
                    }
                },

                getEstimatedCampaignCost() {
                    const count = this.parseCampaignRecipients().length;
                    const rate = parseFloat(this.settingsForm?.cost_marketing || this.stats?.cost_per_message || 0.15);
                    return (count * rate).toFixed(2);
                },

                async loadAllData() {
                    this.isRefreshing = true;
                    try {
                        const dateParams = new URLSearchParams();
                        if (this.dateFrom) dateParams.append('date_from', this.dateFrom);
                        if (this.dateTo) dateParams.append('date_to', this.dateTo);
                        if (this.trafficType) dateParams.append('traffic_type', this.trafficType);
                        const qs = dateParams.toString() ? '?' + dateParams.toString() : '';

                        const [resStats, resConvs, resReports, resCampaigns] = await Promise.all([
                            fetch('/api/analytics' + qs).then(r => r.ok ? r.json() : {}).catch(() => ({})),
                            fetch('/api/conversations').then(r => r.ok ? r.json() : { conversations: [] }).catch(() => ({ conversations: [] })),
                            fetch('/api/reports' + (qs ? qs + '&limit=500' : '?limit=500')).then(r => r.ok ? r.json() : { reports: [] }).catch(() => ({ reports: [] })),
                            fetch('/api/campaigns').then(r => r.ok ? r.json() : []).catch(() => [])
                        ]);

                        this.stats = resStats || {};
                        this.conversations = (resConvs && resConvs.conversations) ? resConvs.conversations : (Array.isArray(resConvs) ? resConvs : []);
                        this.reports = (resReports && resReports.reports) ? resReports.reports : (Array.isArray(resReports) ? resReports : []);
                        this.filteredReports = this.reports;
                        this.campaigns = Array.isArray(resCampaigns) ? resCampaigns : [];

                        if (this.conversations.length > 0 && !this.selectedConv) {
                            this.selectChat(this.conversations[0]);
                        }
                        this.updateCharts();
                    } catch (e) {
                        console.error('Error loading dashboard data:', e);
                    } finally {
                        this.isRefreshing = false;
                    }
                },

                isSyncingDLR: false,

                async loadAdsPerformance() {
                    try {
                        const res = await fetch('/api/ads/performance');
                        if (res.ok) {
                            this.adsData = await res.json();
                        }
                    } catch (e) {
                        console.error('Error loading ads performance:', e);
                    }
                },

                async syncAds() {
                    this.isSyncingAds = true;
                    try {
                        const res = await fetch('/api/ads/sync', { method: 'POST' });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.data) {
                                this.adsData = data.data;
                            }
                            alert('Snapchat & Meta Ads metrics synced successfully!');
                        } else {
                            alert('Failed to sync ads performance');
                        }
                    } catch (e) {
                        alert('Sync error: ' + e);
                    } finally {
                        this.isSyncingAds = false;
                    }
                },

                async loadAdsSettings() {
                    try {
                        const res = await fetch('/api/ads/settings');
                        if (res.ok) {
                            const data = await res.json();
                            this.adsSettingsForm = {
                                meta: {
                                    enabled: data.meta?.enabled ?? true,
                                    ad_account_id: data.meta?.ad_account_id || '',
                                    access_token: data.meta?.masked_token || '',
                                    status: data.meta?.status || 'demo_mode'
                                },
                                snapchat: {
                                    enabled: data.snapchat?.enabled ?? true,
                                    ad_account_id: data.snapchat?.ad_account_id || '',
                                    client_id: data.snapchat?.client_id || '',
                                    client_secret: '',
                                    refresh_token: data.snapchat?.masked_token || '',
                                    status: data.snapchat?.status || 'demo_mode'
                                },
                                whatsapp_business_phone: data.whatsapp_business_phone || '966559421442'
                            };
                        }
                    } catch (e) {
                        console.error('Error loading ads settings:', e);
                    }
                },

                async saveAdsSettings() {
                    this.isSavingAdsSettings = true;
                    try {
                        const payload = {
                            meta: {
                                enabled: this.adsSettingsForm.meta.enabled,
                                ad_account_id: this.adsSettingsForm.meta.ad_account_id,
                                access_token: this.adsSettingsForm.meta.access_token
                            },
                            snapchat: {
                                enabled: this.adsSettingsForm.snapchat.enabled,
                                ad_account_id: this.adsSettingsForm.snapchat.ad_account_id,
                                client_id: this.adsSettingsForm.snapchat.client_id,
                                client_secret: this.adsSettingsForm.snapchat.client_secret,
                                refresh_token: this.adsSettingsForm.snapchat.refresh_token
                            },
                            whatsapp_business_phone: this.adsSettingsForm.whatsapp_business_phone
                        };
                        const res = await fetch('/api/ads/settings', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        if (res.ok) {
                            alert('Ads integration settings saved successfully!');
                            this.showAdsSettingsModal = false;
                            await this.loadAdsPerformance();
                        } else {
                            alert('Failed to save ads settings');
                        }
                    } catch (e) {
                        alert('Error saving ads settings: ' + e);
                    } finally {
                        this.isSavingAdsSettings = false;
                    }
                },

                async generateTrackingLink() {
                    try {
                        const res = await fetch('/api/ads/tracking-link', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                platform: this.adsLinkGen.platform,
                                keyword: this.adsLinkGen.keyword,
                                custom_text: this.adsLinkGen.custom_text
                            })
                        });
                        if (res.ok) {
                            const data = await res.json();
                            this.adsLinkGen.result_url = data.url;
                        }
                    } catch (e) {
                        alert('Error generating link: ' + e);
                    }
                },

                copyTrackingLink() {
                    if (!this.adsLinkGen.result_url) return;
                    navigator.clipboard.writeText(this.adsLinkGen.result_url);
                    alert('Tracking wa.me link copied to clipboard! Paste it into your Snapchat / Meta Ad setup.');
                },

                filteredAdsCampaigns() {
                    let list = this.adsData?.campaigns || [];
                    if (this.adsPlatformFilter !== 'ALL') {
                        list = list.filter(c => c.platform === this.adsPlatformFilter);
                    }
                    if (this.adsSearch && this.adsSearch.trim()) {
                        const q = this.adsSearch.toLowerCase();
                        list = list.filter(c => 
                            (c.campaign_name || '').toLowerCase().includes(q) ||
                            (c.ad_keyword || '').toLowerCase().includes(q) ||
                            (c.platform_label || '').toLowerCase().includes(q)
                        );
                    }
                    return list;
                },

                async exchangeSnapOAuthCode() {
                    let raw = (this.snapAuthCodeInput || '').trim();
                    if (!raw) return alert('Please paste the authorization code or redirected URL from Snapchat.');
                    let code = raw;
                    if (raw.includes('code=')) {
                        try {
                            const urlObj = new URL(raw.startsWith('http') ? raw : 'https://dummy.com/' + raw);
                            code = urlObj.searchParams.get('code') || raw;
                        } catch(e) {
                            code = raw.split('code=')[1].split('&')[0];
                        }
                    }
                    try {
                        const res = await fetch('/api/ads/snap/exchange-code', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ code: code, redirect_uri: 'https://whatsapp.rush.com.sa/' })
                        });
                        const data = await res.json();
                        if (data.success) {
                            alert('🎉 Snapchat Connected Successfully! Tokens & Ad Account linked.');
                            this.snapAuthCodeInput = '';
                            await this.loadAdsSettings();
                            await this.loadAdsPerformance();
                        } else {
                            alert('Error connecting Snapchat: ' + (data.error || 'Failed to exchange code'));
                        }
                    } catch(e) {
                        alert('Snapchat exchange error: ' + e);
                    }
                },

                // --- Smart Tracking Links Methods ---
                async loadTrackingLinks() {
                    try {
                        const res = await fetch('/api/links');
                        if (res.ok) {
                            this.trackingLinksData = await res.json();
                        }
                    } catch (e) {
                        console.error('Error loading tracking links:', e);
                    }
                },

                openCreateLinkModal() {
                    this.editingLinkSlug = null;
                    this.newLinkForm = {
                        title: '',
                        destination_url: 'https://rush.com.sa/en',
                        slug: '',
                        platform: 'snapchat',
                        status: 'ACTIVE',
                        utm_source: 'snapchat',
                        utm_medium: 'cpc',
                        utm_campaign: '',
                        utm_content: '',
                        utm_term: ''
                    };
                    this.showCreateLinkModal = true;
                },

                openEditLinkModal(link) {
                    this.editingLinkSlug = link.slug;
                    this.newLinkForm = {
                        title: link.title || '',
                        destination_url: link.base_url || link.destination_url || 'https://rush.com.sa/en',
                        slug: link.slug || '',
                        platform: link.platform || 'snapchat',
                        status: link.status || 'ACTIVE',
                        utm_source: link.utm_source || '',
                        utm_medium: link.utm_medium || '',
                        utm_campaign: link.utm_campaign || '',
                        utm_content: link.utm_content || '',
                        utm_term: link.utm_term || ''
                    };
                    this.showCreateLinkModal = true;
                },

                autoFillUtmFromPlatform() {
                    const p = this.newLinkForm.platform || 'snapchat';
                    this.newLinkForm.utm_source = p;
                    if (['snapchat', 'meta', 'tiktok', 'google'].includes(p)) {
                        this.newLinkForm.utm_medium = 'cpc';
                    } else if (['whatsapp', 'sms'].includes(p)) {
                        this.newLinkForm.utm_medium = 'direct_broadcast';
                    } else {
                        this.newLinkForm.utm_medium = 'social';
                    }
                    if (this.newLinkForm.title && !this.newLinkForm.utm_campaign) {
                        this.newLinkForm.utm_campaign = this.newLinkForm.title.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30);
                    }
                    if (this.newLinkForm.title && !this.newLinkForm.slug) {
                        this.newLinkForm.slug = this.newLinkForm.title.toLowerCase().replace(/[^a-z0-9_]/g, '-').slice(0, 25);
                    }
                },

                async submitTrackingLink() {
                    if (!this.newLinkForm.title || !this.newLinkForm.title.trim()) {
                        return alert('Please enter a campaign / link title.');
                    }
                    if (!this.newLinkForm.destination_url || !this.newLinkForm.destination_url.trim()) {
                        return alert('Please enter the destination URL (e.g. https://rush.com.sa/en).');
                    }

                    this.isCreatingLink = true;
                    try {
                        const isEdit = !!this.editingLinkSlug;
                        const url = isEdit ? `/api/links/${this.editingLinkSlug}` : '/api/links';
                        const method = isEdit ? 'PUT' : 'POST';

                        const res = await fetch(url, {
                            method: method,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(this.newLinkForm)
                        });
                        if (res.ok) {
                            const data = await res.json();
                            await this.loadTrackingLinks();
                            this.showCreateLinkModal = false;
                            if (isEdit) {
                                alert(`Smart tracking link updated successfully!\nShort URL: https://whatsapp.rush.com.sa/r/${data.link.slug}`);
                            } else {
                                alert(`Smart tracking link created successfully!\nShort URL: https://whatsapp.rush.com.sa/r/${data.link.slug}`);
                            }
                        } else {
                            const err = await res.json();
                            alert((isEdit ? 'Error updating link: ' : 'Error creating link: ') + (err.error || 'Server error'));
                        }
                    } catch (e) {
                        alert((this.editingLinkSlug ? 'Update link error: ' : 'Create link error: ') + e);
                    } finally {
                        this.isCreatingLink = false;
                    }
                },

                async deleteTrackingLink(slug) {
                    if (!confirm(`Are you sure you want to delete tracking link /r/${slug}?`)) return;
                    try {
                        const res = await fetch(`/api/links/${slug}`, { method: 'DELETE' });
                        if (res.ok) {
                            await this.loadTrackingLinks();
                        } else {
                            alert('Failed to delete tracking link');
                        }
                    } catch (e) {
                        alert('Delete error: ' + e);
                    }
                },

                async openLinkStatsModal(slug) {
                    this.activeLinkStats = null;
                    this.showLinkStatsModal = true;
                    try {
                        const res = await fetch(`/api/links/${slug}/stats`);
                        if (res.ok) {
                            this.activeLinkStats = await res.json();
                        }
                    } catch (e) {
                        console.error('Error loading link stats:', e);
                    }
                },

                async toggleLinkStatus(slug) {
                    try {
                        const res = await fetch(`/api/links/${slug}/toggle-status`, { method: 'POST' });
                        if (res.ok) {
                            await this.loadTrackingLinks();
                        } else {
                            alert('Failed to update status');
                        }
                    } catch (e) {
                        alert('Error updating status: ' + e);
                    }
                },

                openQrModal(url, title) {
                    this.activeQrUrl = url;
                    this.activeQrTitle = title;
                    this.showQrModal = true;
                },

                copyTextToClipboard(text, msg = 'Copied to clipboard!') {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(text);
                        alert(msg);
                    } else {
                        prompt('Copy this text:', text);
                    }
                },

                async loadTemplates(forceRefresh = false) {
                    this.isLoadingTemplates = true;
                    try {
                        const res = await fetch(`/api/templates?refresh=${forceRefresh}`);
                        if (res.ok) {
                            const data = await res.json();
                            this.templates = data.templates || [];
                            if (this.templates.length > 0 && !this.templateForm.name) {
                                this.simulateTemplateOnPhone(this.templates[0]);
                            }
                            if (forceRefresh) {
                                alert(`Synced with Unifonic! Loaded ${this.templates.length} pre-approved templates.`);
                            }
                        } else {
                            if (forceRefresh) {
                                alert('Unifonic API returned HTTP status ' + res.status);
                            }
                        }
                    } catch (e) {
                        console.error('Error loading templates:', e);
                        if (forceRefresh) {
                            alert('Error syncing from Unifonic: ' + e);
                        }
                    } finally {
                        this.isLoadingTemplates = false;
                    }
                },

                async loadUploads() {
                    try {
                        const res = await fetch('/api/uploads');
                        if (res.ok) {
                            const data = await res.json();
                            this.uploads = data.uploads || [];
                        }
                    } catch (e) {
                        console.error('Error loading uploads:', e);
                    }
                },

                async uploadMediaFile(event, targetContext) {
                    const file = event.target.files[0];
                    if (!file) return;

                    this.isUploadingMedia = true;
                    const formData = new FormData();
                    formData.append('file', file);

                    try {
                        const res = await fetch('/api/upload', {
                            method: 'POST',
                            body: formData
                        });
                        const data = await res.json();
                        if (data.success && data.url) {
                            if (targetContext === 'template') {
                                this.templateForm.mediaUrl = data.url;
                            } else if (targetContext === 'create_template') {
                                this.newTemplateForm.mediaUrl = data.url;
                            } else if (targetContext === 'campaign') {
                                this.newCampaign.mediaUrl = data.url;
                            } else if (targetContext === 'chat') {
                                this.chatAttachmentUrl = data.url;
                            } else if (targetContext === 'vault_picker') {
                                if (this.vaultPickerContext === 'template') this.templateForm.mediaUrl = data.url;
                                else if (this.vaultPickerContext === 'create_template') this.newTemplateForm.mediaUrl = data.url;
                                else if (this.vaultPickerContext === 'campaign') this.newCampaign.mediaUrl = data.url;
                                else if (this.vaultPickerContext === 'chat') this.chatAttachmentUrl = data.url;
                                this.showVaultPickerModal = false;
                            }
                            await this.loadUploads();
                        } else {
                            alert('Upload error: ' + (data.error || 'Failed to upload'));
                        }
                    } catch (err) {
                        alert('Upload failed: ' + err);
                    } finally {
                        this.isUploadingMedia = false;
                        event.target.value = '';
                    }
                },

                copyDirectLink(url) {
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(url);
                        alert('Direct link copied to clipboard:\\n' + url);
                    } else {
                        prompt('Copy this direct link:', url);
                    }
                },

                useMediaInTemplate(url) {
                    this.templateForm.mediaUrl = url;
                    this.activeTab = 'templates';
                },

                useMediaInCampaign(url) {
                    this.newCampaign.mediaUrl = url;
                    this.showNewCampaignModal = true;
                },

                async deleteMedia(filename) {
                    if (!confirm('Are you sure you want to delete ' + filename + ' from the VPS?')) return;
                    try {
                        const res = await fetch('/api/uploads/' + filename, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                            await this.loadUploads();
                        } else {
                            alert('Delete error: ' + (data.error || 'Failed to delete'));
                        }
                    } catch (err) {
                        alert('Delete failed: ' + err);
                    }
                },

                setDatePreset(preset) {
                    this.datePreset = preset;
                    const now = new Date();
                    const pad = (n) => n < 10 ? '0' + n : n;
                    const formatYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

                    if (preset === 'all') {
                        this.dateFrom = '';
                        this.dateTo = '';
                    } else if (preset === 'today') {
                        this.dateFrom = formatYMD(now);
                        this.dateTo = formatYMD(now);
                    } else if (preset === 'yesterday') {
                        const y = new Date(now);
                        y.setDate(y.getDate() - 1);
                        this.dateFrom = formatYMD(y);
                        this.dateTo = formatYMD(y);
                    } else if (preset === 'last7') {
                        const d7 = new Date(now);
                        d7.setDate(d7.getDate() - 7);
                        this.dateFrom = formatYMD(d7);
                        this.dateTo = formatYMD(now);
                    } else if (preset === 'last30') {
                        const d30 = new Date(now);
                        d30.setDate(d30.getDate() - 30);
                        this.dateFrom = formatYMD(d30);
                        this.dateTo = formatYMD(now);
                    }

                    this.loadAllData();
                },

                applyCustomDateFilter() {
                    this.datePreset = 'custom';
                    this.loadAllData();
                },

                clearDateFilter() {
                    this.setDatePreset('all');
                },

                async refreshData() {
                    await this.loadAllData();
                    await this.loadTemplates(false);
                    await this.loadUploads();
                },

                getTemplateBodyText(t) {
                    if (!t || !t.components) return '';
                    for (const c of t.components) {
                        if (c.type === 'BODY' && c.text) return c.text;
                    }
                    return t.body || '';
                },

                getTemplateButtons(t) {
                    if (!t || !t.components) return [];
                    for (const c of t.components) {
                        if (c.type === 'BUTTONS' && c.buttons) return c.buttons;
                    }
                    return t.buttons || [];
                },

                getTemplateMediaUrl(t) {
                    if (!t || !t.components) return t.media_url || '';
                    for (const c of t.components) {
                        if (c.type === 'HEADER' && c.example && c.example.header_handle && c.example.header_handle.length > 0) {
                            return c.example.header_handle[0];
                        }
                    }
                    return t.media_url || '';
                },

                copyUnifonicConsoleDetails(t) {
                    const name = t.name;
                    const cat = t.category || 'MARKETING';
                    const lang = t.language || 'ar';
                    const body = this.getTemplateBodyText(t);
                    const media = this.getTemplateMediaUrl(t);
                    const btns = this.getTemplateButtons(t).map(b => `${b.text} (${b.url || 'Quick Reply'})`).join(', ');

                    const text = `=== UNIFONIC CONSOLE TEMPLATE DETAILS ===
Template Name: ${name}
Category: ${cat}
Language: ${lang}
Header Media URL: ${media || 'None'}
Message Body:
${body}
Buttons: ${btns || 'None'}`;

                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(text);
                        alert('Template details copied!\\n\\nTo submit this template to Meta via Unifonic:\\n1. Log into Unifonic Console (el.cloud.unifonic.com)\\n2. Go to Channels > WhatsApp > Templates > Create New Template\\n3. Paste these copied details and submit for Meta approval.');
                    } else {
                        prompt('Copy template details for Unifonic Console:', text);
                    }
                },

                simulateTemplateOnPhone(t) {
                    this.templateForm.name = t.name;
                    this.templateForm.category = t.category || 'MARKETING';
                    this.templateForm.language = t.language || 'ar';
                    this.templateForm.body = this.getTemplateBodyText(t);
                    this.templateForm.buttons = this.getTemplateButtons(t);
                    this.templateForm.mediaUrl = this.getTemplateMediaUrl(t);
                    this.activeTab = 'templates';
                },

                getDetectedCampaignVariables() {
                    const body = this.newCampaign.template || '';
                    const matches = body.match(/\\{\\{([a-zA-Z0-9_]+)\\}\\}/g) || [];
                    const unique = [...new Set(matches.map(m => m.replace(/[\\{\\}]/g, '')))];
                    return unique;
                },

                useApprovedTemplateInCampaign(t) {
                    this.simulateTemplateOnPhone(t);
                    this.newCampaign.name = 'Broadcast - ' + t.name;
                    this.newCampaign.templateName = t.name;
                    this.newCampaign.templateLang = t.language || 'ar';
                    this.newCampaign.template = this.getTemplateBodyText(t);
                    this.newCampaign.mediaUrl = this.getTemplateMediaUrl(t);
                    this.newCampaign.defaultVars = {};
                    this.showNewCampaignModal = true;
                },

                onModalTemplateSelect(tplName) {
                    const match = this.templates.find(t => t.name === tplName);
                    if (match) {
                        this.newCampaign.name = 'Broadcast - ' + match.name;
                        this.newCampaign.templateName = match.name;
                        this.newCampaign.templateLang = match.language || 'ar';
                        this.newCampaign.template = this.getTemplateBodyText(match);
                        this.newCampaign.mediaUrl = this.getTemplateMediaUrl(match);
                        this.newCampaign.defaultVars = {};
                    }
                },

                parseCampaignRecipients() {
                    if (!this.newCampaign.rawNumbers) return [];
                    const lines = this.newCampaign.rawNumbers
                        .split('\\n')
                        .map(l => l.trim())
                        .filter(l => l.length > 0 && !l.startsWith('#'));

                    const detectedVars = this.getDetectedCampaignVariables();
                    const parsed = [];

                    for (const line of lines) {
                        let parts = [];
                        if (line.includes(',')) parts = line.split(',').map(p => p.trim());
                        else if (line.includes('\\t')) parts = line.split('\\t').map(p => p.trim());
                        else if (line.includes('|')) parts = line.split('|').map(p => p.trim());
                        else if (line.includes(';')) parts = line.split(';').map(p => p.trim());
                        else parts = [line.trim()];

                        const phone = parts[0];
                        if (!phone || phone.length < 5) continue;

                        // Skip header row if first column contains non-numeric header labels
                        const cleanDigits = phone.replace(/\\D/g, '');
                        if (cleanDigits.length < 7) continue;

                        const varsList = parts.slice(1);
                        const recipientObj = { phone: phone, vars: varsList };

                        detectedVars.forEach((vKey, idx) => {
                            if (idx < varsList.length && varsList[idx] !== '') {
                                recipientObj[vKey] = varsList[idx];
                            } else if (this.newCampaign.defaultVars && this.newCampaign.defaultVars[vKey]) {
                                recipientObj[vKey] = this.newCampaign.defaultVars[vKey];
                            } else {
                                recipientObj[vKey] = '';
                            }
                        });

                        parsed.push(recipientObj);
                    }
                    return parsed;
                },

                getCampaignRecipientPreview(rec) {
                    let text = this.newCampaign.template || '';
                    if (rec.vars && Array.isArray(rec.vars)) {
                        rec.vars.forEach((v, idx) => {
                            text = text.replace(new RegExp('\\\\{\\\\{' + (idx + 1) + '\\\\}\\\\}', 'g'), v || '');
                        });
                    }
                    for (const [k, v] of Object.entries(rec)) {
                        if (k !== 'phone' && k !== 'vars') {
                            text = text.replace(new RegExp('\\\\{\\\\{' + k + '\\\\}\\\\}', 'g'), v || '');
                        }
                    }
                    return text;
                },

                downloadCampaignCSVTemplate() {
                    const vars = this.getDetectedCampaignVariables();
                    const rawName = this.newCampaign.templateName || this.newCampaign.name || 'campaign';
                    const cleanName = rawName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
                    this.generateAndDownloadCSV(cleanName, vars);
                },

                downloadTemplateCSV(t) {
                    if (!t) return;
                    const body = this.getTemplateBodyText(t);
                    const matches = body.match(/\\{\\{([a-zA-Z0-9_]+)\\}\\}/g) || [];
                    const vars = [...new Set(matches.map(m => m.replace(/[\\{\\}]/g, '')))];
                    const rawName = t.name || 'template';
                    const cleanName = rawName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
                    this.generateAndDownloadCSV(cleanName, vars);
                },

                generateAndDownloadCSV(name, vars) {
                    const headers = ['phone'];
                    const sampleRow1 = ['966569809578'];
                    const sampleRow2 = ['966553337736'];
                    const sampleRow3 = ['966501234567'];

                    if (vars && vars.length > 0) {
                        vars.forEach((v, idx) => {
                            headers.push(v);
                            if (v === '1' || idx === 0) {
                                sampleRow1.push('FIRSTWASH-101');
                                sampleRow2.push('FIRSTWASH-102');
                                sampleRow3.push('FIRSTWASH-103');
                            } else if (v === '2' || idx === 1) {
                                sampleRow1.push('محمد');
                                sampleRow2.push('أحمد');
                                sampleRow3.push('سارة');
                            } else {
                                sampleRow1.push('قيمة_' + (idx + 1));
                                sampleRow2.push('قيمة_' + (idx + 1));
                                sampleRow3.push('قيمة_' + (idx + 1));
                            }
                        });
                    }

                    const csvRows = [
                        headers.join(','),
                        sampleRow1.join(','),
                        sampleRow2.join(','),
                        sampleRow3.join(',')
                    ];

                    const csvContent = '\\uFEFF' + csvRows.join('\\r\\n');
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.setAttribute('href', url);
                    link.setAttribute('download', `rush_template_${name}_variables.csv`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                },

                handleCampaignCSVUpload(event) {
                    const file = event.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const content = e.target.result || '';
                        this.newCampaign.rawNumbers = content;
                        event.target.value = '';
                    };
                    reader.readAsText(file);
                },

                async selectChat(conv) {
                    if (!conv) return;
                    this.selectedConv = conv;
                    try {
                        const res = await fetch(`/api/conversations/${conv.phone}/messages`);
                        if (res.ok) {
                            const data = await res.json();
                            this.activeChatMessages = data.messages || (Array.isArray(data) ? data : []);
                        } else {
                            this.activeChatMessages = [];
                        }
                    } catch (e) {
                        this.activeChatMessages = [];
                    }
                },

                async sendDirectReply() {
                    if ((!this.replyText.trim() && !this.chatAttachmentUrl) || !this.selectedConv) return;
                    const text = this.replyText;
                    const media_url = this.chatAttachmentUrl;
                    this.replyText = '';
                    this.chatAttachmentUrl = '';
                    
                    try {
                        await fetch(`/api/conversations/${this.selectedConv.phone}/reply`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text, media_url })
                        });
                        await this.selectChat(this.selectedConv);
                    } catch (e) {
                        alert('Error sending reply: ' + e);
                    }
                },

                async launchCampaign() {
                    if (!this.newCampaign.name) {
                        alert('Please enter a campaign name.');
                        return;
                    }

                    const recipients = this.parseCampaignRecipients();
                    if (recipients.length === 0) {
                        alert('Please paste or upload at least one valid recipient phone number.');
                        return;
                    }

                    try {
                        const res = await fetch('/api/campaigns', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                name: this.newCampaign.name,
                                message_template: this.newCampaign.template,
                                template_name: this.newCampaign.templateName || null,
                                template_language: this.newCampaign.templateLang || 'ar',
                                recipients: recipients,
                                media_url: this.newCampaign.mediaUrl || null
                            })
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.showNewCampaignModal = false;
                            this.activeTab = 'campaigns';
                            await this.loadAllData();
                        } else {
                            alert('Failed to launch campaign: ' + (data.error || 'Unknown error'));
                        }
                    } catch (e) {
                        alert('Failed to launch campaign: ' + e);
                    }
                },

                filteredConversations() {
                    if (!this.chatSearch.trim()) return this.conversations;
                    const q = this.chatSearch.toLowerCase();
                    return this.conversations.filter(c => 
                        (c.phone && c.phone.includes(q)) || 
                        (c.last_message && c.last_message.toLowerCase().includes(q))
                    );
                },

                filterDLR() {
                    this.filteredReports = this.reports.filter(r => {
                        const matchStatus = this.dlrStatusFilter === 'ALL' || r.status === this.dlrStatusFilter;
                        const matchPhone = !this.dlrPhoneSearch.trim() || (r.recipient && r.recipient.includes(this.dlrPhoneSearch.trim()));
                        return matchStatus && matchPhone;
                    });
                },

                exportDLRToCSV() {
                    const params = new URLSearchParams();
                    if (this.dateFrom) params.append('date_from', this.dateFrom);
                    if (this.dateTo) params.append('date_to', this.dateTo);
                    if (this.dlrStatusFilter && this.dlrStatusFilter !== 'ALL') params.append('status', this.dlrStatusFilter);
                    if (this.dlrPhoneSearch.trim()) params.append('phone', this.dlrPhoneSearch.trim());
                    
                    window.location.href = '/api/reports/export?' + params.toString();
                },

                async syncUnifonicStatuses() {
                    this.isSyncingDLR = true;
                    try {
                        const res = await fetch('/api/unifonic/sync', { method: 'POST' });
                        const data = await res.json();
                        if (data.success) {
                            alert(`Synced with Unifonic! Queried ${data.queried_count || 0} messages, updated ${data.updated_records || 0} live carrier statuses.`);
                            await this.loadAllData();
                        } else {
                            alert('Sync error: ' + (data.error || data.message || 'Failed'));
                        }
                    } catch (e) {
                        alert('Sync failed: ' + e);
                    } finally {
                        this.isSyncingDLR = false;
                    }
                },

                insertVariable() {
                    this.templateForm.body += ' {{1}}';
                },

                renderPreviewBody() {
                    return (this.templateForm.body || '')
                        .replace(/\\{\\{1\\}\\}/g, 'محمد')
                        .replace(/\\{\\{2\\}\\}/g, 'RUSH2026')
                        .replace(/\\{\\{name\\}\\}/g, 'محمد');
                },

                useTemplateInCampaign() {
                    this.newCampaign.name = 'Broadcast - ' + this.templateForm.name;
                    this.newCampaign.templateName = this.templateForm.name;
                    this.newCampaign.templateLang = this.templateForm.language || 'ar';
                    this.newCampaign.template = this.templateForm.body;
                    this.newCampaign.mediaUrl = this.templateForm.mediaUrl || '';
                    this.newCampaign.defaultVars = {};
                    this.showNewCampaignModal = true;
                },

                countTemplatesByStatus(st) {
                    if (!this.templates) return 0;
                    if (st === 'IN_REVIEW') {
                        return this.templates.filter(t => (t.status === 'IN_REVIEW' || t.status === 'PENDING' || !t.status)).length;
                    }
                    return this.templates.filter(t => t.status === st).length;
                },

                filteredTemplates() {
                    let list = this.templates || [];
                    if (this.templateStatusFilter !== 'ALL') {
                        if (this.templateStatusFilter === 'IN_REVIEW') {
                            list = list.filter(t => t.status === 'IN_REVIEW' || t.status === 'PENDING' || !t.status);
                        } else {
                            list = list.filter(t => t.status === this.templateStatusFilter);
                        }
                    }
                    if (this.templateSearch && this.templateSearch.trim()) {
                        const q = this.templateSearch.toLowerCase().trim();
                        list = list.filter(t => (t.name && t.name.toLowerCase().includes(q)) || (this.getTemplateBodyText(t).toLowerCase().includes(q)));
                    }
                    return list;
                },

                getStatusBadgeClass(st) {
                    st = (st || 'IN_REVIEW').toUpperCase();
                    if (st === 'APPROVED') return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
                    if (st === 'IN_REVIEW' || st === 'PENDING') return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
                    if (st === 'REJECTED') return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
                    return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
                },

                getStatusIconClass(st) {
                    st = (st || 'IN_REVIEW').toUpperCase();
                    if (st === 'APPROVED') return 'fas fa-check-circle text-[9px]';
                    if (st === 'IN_REVIEW' || st === 'PENDING') return 'fas fa-hourglass-half text-[9px]';
                    if (st === 'REJECTED') return 'fas fa-times-circle text-[9px]';
                    return 'fas fa-info-circle text-[9px]';
                },

                async changeTemplateStatus(name, newStatus) {
                    try {
                        const res = await fetch(`/api/templates/${encodeURIComponent(name)}/status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: newStatus })
                        });
                        const data = await res.json();
                        if (data.success) {
                            const match = this.templates.find(item => item.name === name);
                            if (match) match.status = newStatus;
                            await this.loadTemplates(false);
                        } else {
                            alert('Error updating status: ' + (data.error || 'Failed'));
                        }
                    } catch (e) {
                        alert('Failed to update status: ' + e);
                    }
                },

                openVaultPicker(context) {
                    this.vaultPickerContext = context;
                    this.vaultSearchQuery = '';
                    this.showVaultPickerModal = true;
                    this.loadUploads();
                },

                selectVaultMedia(url) {
                    if (this.vaultPickerContext === 'template') {
                        this.templateForm.mediaUrl = url;
                    } else if (this.vaultPickerContext === 'create_template') {
                        this.newTemplateForm.mediaUrl = url;
                    } else if (this.vaultPickerContext === 'campaign') {
                        this.newCampaign.mediaUrl = url;
                    } else if (this.vaultPickerContext === 'chat') {
                        this.chatAttachmentUrl = url;
                    }
                    this.showVaultPickerModal = false;
                },

                filteredVaultUploads() {
                    if (!this.vaultSearchQuery.trim()) return this.uploads || [];
                    const q = this.vaultSearchQuery.toLowerCase().trim();
                    return (this.uploads || []).filter(u => u.filename && u.filename.toLowerCase().includes(q));
                },

                openCreateTemplateModal() {
                    this.newTemplateForm = {
                        name: '',
                        category: 'MARKETING',
                        language: 'ar',
                        status: 'IN_REVIEW',
                        body: '',
                        mediaUrl: '',
                        buttonType: 'URL',
                        buttonText: '',
                        buttonUrl: ''
                    };
                    this.createTemplateTab = 'form';
                    this.showCreateTemplateModal = true;
                },

                insertVariableInNewTemplate(v) {
                    this.newTemplateForm.body = (this.newTemplateForm.body ? this.newTemplateForm.body + ' ' : '') + v;
                },

                getCurlCodeSnippet() {
                    const name = this.newTemplateForm.name ? this.newTemplateForm.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') : 'rush_ramadan_promo';
                    const category = this.newTemplateForm.category || 'MARKETING';
                    const lang = this.newTemplateForm.language || 'ar';
                    const status = this.newTemplateForm.status || 'IN_REVIEW';
                    const body = this.newTemplateForm.body || 'أهلاً بك {{1}} في مغسلة رش! يسعدنا تقديم كود خصم خاص {{2}}...';
                    const media = this.newTemplateForm.mediaUrl || null;
                    const buttons = this.newTemplateForm.buttonText ? [{
                        type: this.newTemplateForm.buttonType,
                        text: this.newTemplateForm.buttonText,
                        url: this.newTemplateForm.buttonUrl || undefined
                    }] : null;

                    const payload = {
                        name: name,
                        body: body,
                        category: category,
                        language: lang,
                        status: status,
                        media_url: media,
                        buttons: buttons
                    };

                    return `curl -X POST "https://whatsapp.rush.com.sa/api/templates" \
  -H "Content-Type: application/json" \
  -d '${JSON.stringify(payload, null, 2)}'`;
                },

                copyCurlSnippet() {
                    const code = this.getCurlCodeSnippet();
                    if (navigator.clipboard) {
                        navigator.clipboard.writeText(code);
                        alert('cURL command copied to clipboard!');
                    } else {
                        prompt('Copy cURL command:', code);
                    }
                },

                async submitCreateTemplate() {
                    if (!this.newTemplateForm.name || !this.newTemplateForm.name.trim()) {
                        alert('Please enter a template name.');
                        return;
                    }
                    if (!this.newTemplateForm.body || !this.newTemplateForm.body.trim()) {
                        alert('Please enter the template body.');
                        return;
                    }

                    this.isSubmittingTemplate = true;
                    try {
                        const payload = {
                            name: this.newTemplateForm.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
                            category: this.newTemplateForm.category,
                            language: this.newTemplateForm.language,
                            status: this.newTemplateForm.status || 'IN_REVIEW',
                            body: this.newTemplateForm.body.trim(),
                            media_url: this.newTemplateForm.mediaUrl || null,
                            buttons: this.newTemplateForm.buttonText ? [{
                                type: this.newTemplateForm.buttonType,
                                text: this.newTemplateForm.buttonText,
                                url: this.newTemplateForm.buttonUrl || undefined
                            }] : null
                        };

                        const res = await fetch('/api/templates', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        const data = await res.json();

                        if (data.success) {
                            alert('Template "' + payload.name + '" created successfully with status "' + (payload.status) + '"!');
                            this.showCreateTemplateModal = false;
                            await this.loadTemplates(true);
                            this.activeTab = 'templates';
                        } else {
                            alert('Error creating template: ' + (data.error || data.message || 'Unknown error'));
                        }
                    } catch (err) {
                        alert('Failed to create template: ' + err);
                    } finally {
                        this.isSubmittingTemplate = false;
                    }
                },

                initCharts() {
                    if (typeof Chart === 'undefined') {
                        console.warn('Chart.js not yet loaded');
                        return;
                    }
                    try {
                        const ctxTraffic = document.getElementById('trafficChart')?.getContext('2d');
                        if (ctxTraffic) {
                            if (this.trafficChartInstance) this.trafficChartInstance.destroy();
                            this.trafficChartInstance = new Chart(ctxTraffic, {
                                type: 'bar',
                                data: {
                                    labels: ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'],
                                    datasets: [
                                        {
                                            label: 'Delivered',
                                            data: [12, 19, 45, 80, 110, 95, 70, 85, 120, 65, 40],
                                            backgroundColor: rwVar('--chart-1'),
                                            borderRadius: 6
                                        },
                                        {
                                            label: 'Inbound Replies',
                                            data: [3, 5, 12, 28, 42, 35, 20, 31, 48, 22, 15],
                                            backgroundColor: rwVar('--chart-3'),
                                            borderRadius: 6
                                        }
                                    ]
                                },
                                options: {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: { legend: { labels: { color: rwVar('--muted-foreground'), font: { size: 11 } } } },
                                    scales: {
                                        x: { grid: { display: false }, ticks: { color: rwVar('--muted-foreground') } },
                                        y: { grid: { color: rwVar('--border') }, ticks: { color: rwVar('--muted-foreground') } }
                                    }
                                }
                            });
                        }
                    } catch (e) {
                        console.error('Traffic chart error:', e);
                    }

                    try {
                        const ctxDonut = document.getElementById('statusDonutChart')?.getContext('2d');
                        if (ctxDonut) {
                            if (this.donutChartInstance) this.donutChartInstance.destroy();
                            this.donutChartInstance = new Chart(ctxDonut, {
                                type: 'doughnut',
                                data: {
                                    labels: ['Read', 'Delivered', 'Failed'],
                                    datasets: [{
                                        data: [this.stats.read_count || 120, this.stats.delivered_count || 85, this.stats.failed_count || 3],
                                        backgroundColor: [rwVar('--chart-3'), rwVar('--chart-2'), rwVar('--chart-1')],
                                        borderWidth: 0
                                    }]
                                },
                                options: {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: { legend: { display: false } },
                                    cutout: '75%'
                                }
                            });
                        }
                    } catch (e) {
                        console.error('Donut chart error:', e);
                    }
                },

                updateCharts() {
                    try {
                        if (this.donutChartInstance) {
                            this.donutChartInstance.data.datasets[0].data = [
                                this.stats.read_count || 10,
                                this.stats.delivered_count || 20,
                                this.stats.failed_count || 1
                            ];
                            this.donutChartInstance.update();
                        }
                    } catch (e) {}
                },

                startEventSource() {
                    if (typeof EventSource === 'undefined') return;
                    try {
                        const evtSource = new EventSource('/api/events/stream');
                        evtSource.onmessage = (event) => {
                            try {
                                const data = JSON.parse(event.data);
                                if (data.type === 'webhook_event') {
                                    this.loadAllData();
                                }
                            } catch (e) {}
                        };
                    } catch (e) {}
                },

                formatDate(d) {
                    if (!d) return '-';
                    try { return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch(e) { return d; }
                },

                formatTime(d) {
                    if (!d) return '';
                    try { return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); } catch(e) { return ''; }
                }
            };
        }

        // Expose globally and register for Alpine
        window.whatsappDashboard = whatsappDashboard;
        document.addEventListener('alpine:init', () => {
            Alpine.data('whatsappDashboard', whatsappDashboard);
        });
    </script>
    <!-- Alpine.js Core (Loads after component definition is in place) -->
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.3/dist/cdn.min.js"></script>

    <style>
        [x-cloak] { display: none !important; }
        .phone-mockup {
            width: 320px;
            height: 580px;
            border: 10px solid var(--foreground);
            border-radius: 36px;
            box-shadow: var(--shadow-card);
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            background: var(--background);
        }
    </style>
</head>
<body class="bg-wa-deep text-wa-text font-sans antialiased min-h-screen flex flex-col" x-data="whatsappDashboard()" x-init="initDashboard()">

    <!-- Top Executive Header -->
    <header class="bg-wa-panel border-b border-wa-border px-6 py-3.5 flex items-center justify-between sticky top-0 z-30">
        <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
                <img src="/static/brand/img/rush-app-logo.svg" alt="Rush Wash" class="h-6 w-auto max-w-none shrink-0">
                <div class="w-7 h-7 rounded-full bg-wa-green text-white flex items-center justify-center text-xs">
                    <i class="fab fa-whatsapp"></i>
                </div>
            </div>
            <div>
                <h1 class="text-sm font-bold text-white flex items-center gap-2">
                    WhatsApp Enterprise Command Center
                    <span class="text-[10px] bg-wa-green/20 text-wa-green-bright border border-wa-green/30 px-2 py-0.5 rounded-full font-semibold">Official WABA</span>
                </h1>
                <p class="text-[11px] text-wa-muted flex items-center gap-2">
                    <span>Account: <strong>RushWash KSA</strong></span>
                    <span class="text-wa-border">&bull;</span>
                    <span>Media Hosting &amp; Multi-Agent Operations</span>
                </p>
            </div>
        </div>

        <div class="flex items-center gap-3">
            <!-- Dedicated Lifecycle Funnel Shortcut -->
            <a 
                href="/funnel" 
                class="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-red-600/20 transition-all transform hover:-translate-y-0.5"
                title="Customer Lifecycle Funnel & Cadence Studio"
            >
                <i class="fas fa-filter text-xs text-yellow-300"></i>
                <span>Lifecycle Funnel</span>
            </a>

            <!-- 10K Growth Plan Shortcut -->
            <a 
                href="/ops/growth" 
                class="flex items-center gap-1.5 px-3 py-1.5 bg-wa-surface hover:bg-wa-panel text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-xl text-xs font-semibold transition-all transform hover:-translate-y-0.5"
                title="10K Growth Plan Dashboard"
            >
                <i class="fas fa-rocket text-xs"></i>
                <span>Growth Plan</span>
            </a>

            <!-- Free First Wash Hub Shortcut -->
            <a 
                href="/freewash" 
                class="flex items-center gap-1.5 px-3 py-1.5 bg-wa-surface hover:bg-wa-panel text-amber-400 hover:text-amber-300 border border-amber-500/30 rounded-xl text-xs font-semibold transition-all transform hover:-translate-y-0.5"
                title="Free First Wash (CMP-00032/33) Redemption Hub"
            >
                <i class="fas fa-gift text-xs"></i>
                <span>Free Wash</span>
            </a>

            <!-- Open Chatwoot Workspace Button -->
            <a 
                href="https://chatwoot.rush.com.sa" 
                target="_blank" 
                class="flex items-center gap-2 px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-500/20 transition-all transform hover:-translate-y-0.5"
            >
                <i class="fas fa-comments text-xs"></i>
                <span>Open Chatwoot Workspace</span>
                <i class="fas fa-external-link-alt text-[10px] opacity-70"></i>
            </a>

            <!-- Telemetry Indicator -->
            <div class="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-wa-panel border border-wa-border text-xs text-wa-muted">
                <span class="w-2 h-2 rounded-full bg-wa-green"></span>
                <span>Bridge: <strong class="text-white">Active</strong></span>
            </div>

            <!-- Theme toggle -->
            <button type="button" onclick="rwToggleTheme()" class="rw-theme-toggle" title="Toggle theme" aria-label="Toggle light / dark theme">
                <svg class="rw-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
                <svg class="rw-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
            </button>

            <!-- Refresh Button -->
            <button @click="refreshData()" class="p-2 rounded-xl bg-wa-panel hover:bg-wa-surface text-wa-muted hover:text-white border border-wa-border transition-colors" title="Refresh Data">
                <i class="fas fa-sync-alt text-xs" :class="{'fa-spin': isRefreshing}"></i>
            </button>

            <!-- Logout -->
            <a href="/logout" class="p-2 rounded-xl bg-wa-panel hover:bg-red-500/10 text-wa-muted hover:text-red-400 border border-wa-border transition-colors" title="Sign Out">
                <i class="fas fa-sign-out-alt text-xs"></i>
            </a>
        </div>
    </header>

    <!-- Mobile Horizontal Navigation Bar -->
    <nav class="md:hidden flex items-center overflow-x-auto bg-wa-panel border-b border-wa-border px-3 py-2 gap-2 shrink-0">
        <button 
            @click="activeTab = 'analytics'" 
            :class="activeTab === 'analytics' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-chart-pie"></i>
            <span>Analytics</span>
        </button>
        <button 
            @click="activeTab = 'campaigns'" 
            :class="activeTab === 'campaigns' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-bullhorn"></i>
            <span>Campaigns</span>
        </button>
        <button 
            @click="activeTab = 'templates'" 
            :class="activeTab === 'templates' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-layer-group"></i>
            <span>Templates</span>
        </button>
        <button 
            @click="activeTab = 'chats'" 
            :class="activeTab === 'chats' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-comments"></i>
            <span>Chats</span>
        </button>
        <button 
            @click="activeTab = 'media'" 
            :class="activeTab === 'media' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-photo-video"></i>
            <span>Media Vault</span>
        </button>
        <button 
            @click="activeTab = 'dlr'" 
            :class="activeTab === 'dlr' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-receipt"></i>
            <span>DLR Reports</span>
        </button>
        <button 
            @click="activeTab = 'ads'" 
            :class="activeTab === 'ads' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-bullseye text-wa-muted"></i>
            <span>Snap &amp; Meta Ads</span>
        </button>
        <button 
            @click="activeTab = 'links'" 
            :class="activeTab === 'links' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-link text-wa-muted"></i>
            <span>Smart Links</span>
        </button>
        <a 
            href="/cron" 
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all text-purple-400 bg-purple-500/10 border border-purple-500/30 font-bold hover:bg-purple-500/20"
        >
            <i class="fas fa-calendar-check text-wa-muted"></i>
            <span>Cron Jobs</span>
        </a>
        <button 
            @click="activeTab = 'settings'" 
            :class="activeTab === 'settings' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition-all"
        >
            <i class="fas fa-coins text-wa-muted"></i>
            <span>Cost &amp; Settings</span>
        </button>
    </nav>

    <!-- Main Container -->
    <div class="flex-1 flex overflow-hidden">

        <!-- Sidebar Navigation Tabs -->
        <aside class="w-64 glass-panel border-r border-wa-border flex flex-col justify-between p-4 hidden md:flex shrink-0">
            <div class="space-y-1.5">
                <div class="text-[11px] font-semibold text-wa-muted uppercase tracking-wider px-3 mb-2">Navigation</div>

                <a 
                    href="/cron" 
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left bg-wa-surface text-wa-text border border-wa-border mb-2 font-bold shadow-md shadow-purple-950/20"
                >
                    <i class="fas fa-calendar-check text-sm w-4 text-wa-muted"></i>
                    <span>Cron &amp; Wave Center</span>
                    <span class="ml-auto text-[10px] bg-wa-green/10 text-wa-green-bright px-1.5 py-0.5 rounded font-bold">Live</span>
                </a>

                <button 
                    @click="activeTab = 'analytics'" 
                    :class="activeTab === 'analytics' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left"
                >
                    <i class="fas fa-chart-pie text-sm w-4"></i>
                    <span>Executive Analytics</span>
                </button>

                <button 
                    @click="activeTab = 'campaigns'" 
                    :class="activeTab === 'campaigns' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left"
                >
                    <i class="fas fa-bullhorn text-sm w-4"></i>
                    <span>Bulk Campaigns</span>
                    <span class="ml-auto text-[10px] bg-wa-green/20 text-wa-green-bright px-1.5 py-0.5 rounded font-bold">New</span>
                </button>

                <button 
                    @click="activeTab = 'templates'" 
                    :class="activeTab === 'templates' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left"
                >
                    <i class="fas fa-layer-group text-sm w-4"></i>
                    <span>Template Studio</span>
                    <span class="ml-auto text-[10px] bg-wa-surface text-wa-muted px-1.5 py-0.5 rounded font-bold" x-text="templates.length || 6"></span>
                </button>

                <button 
                    @click="activeTab = 'chats'" 
                    :class="activeTab === 'chats' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left"
                >
                    <i class="fas fa-comments text-sm w-4"></i>
                    <span>Live Conversations</span>
                    <span class="ml-auto text-[10px] bg-wa-surface px-1.5 py-0.5 rounded text-wa-text font-bold" x-text="conversations.length"></span>
                </button>

                <button 
                    @click="activeTab = 'ads'" 
                    :class="activeTab === 'ads' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left group"
                >
                    <i class="fas fa-bullseye text-sm w-4 text-wa-muted group-hover:scale-110 transition-transform"></i>
                    <span>Snap &amp; Meta Ads</span>
                    <span class="ml-auto text-[10px] bg-wa-surface text-wa-muted px-1.5 py-0.5 rounded font-bold" x-text="(adsData?.overview?.blended_roas || '3.5') + 'x ROAS'"></span>
                </button>

                <button 
                    @click="activeTab = 'links'" 
                    :class="activeTab === 'links' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left group"
                >
                    <i class="fas fa-link text-sm w-4 text-wa-muted group-hover:scale-110 transition-transform"></i>
                    <span>Smart Tracking Links</span>
                    <span class="ml-auto text-[10px] bg-wa-surface text-wa-muted px-1.5 py-0.5 rounded font-bold" x-text="(trackingLinksData?.total_clicks || 0) + ' Clicks'"></span>
                </button>

                <button 
                    @click="activeTab = 'media'" 
                    :class="activeTab === 'media' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left"
                >
                    <i class="fas fa-photo-video text-sm w-4"></i>
                    <span>Media Vault (VPS Links)</span>
                    <span class="ml-auto text-[10px] bg-wa-surface text-wa-muted px-1.5 py-0.5 rounded font-bold" x-text="uploads.length || 0"></span>
                </button>

                <button 
                    @click="activeTab = 'dlr'" 
                    :class="activeTab === 'dlr' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left"
                >
                    <i class="fas fa-receipt text-sm w-4"></i>
                    <span>DLR Delivery Reports</span>
                </button>

                <button 
                    @click="activeTab = 'settings'" 
                    :class="activeTab === 'settings' ? 'bg-wa-green/10 text-wa-green-bright font-semibold border border-wa-green/20' : 'text-wa-muted hover:bg-wa-surface hover:text-wa-text border border-transparent'"
                    class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs transition-all text-left"
                >
                    <i class="fas fa-coins text-sm w-4 text-wa-muted"></i>
                    <span>Pricing &amp; Settings</span>
                    <span class="ml-auto text-[10px] bg-wa-surface text-wa-muted px-1.5 py-0.5 rounded font-bold" x-text="stats.currency || 'SAR'"></span>
                </button>
            </div>

            <!-- Server Telemetry Card -->
            <div class="p-3.5 rounded-2xl bg-wa-panel border border-wa-border space-y-2">
                <div class="flex items-center justify-between text-xs">
                    <span class="text-wa-muted">Provider:</span>
                    <span class="font-bold text-white">Unifonic WABA</span>
                </div>
                <div class="flex items-center justify-between text-xs">
                    <span class="text-wa-muted">Chatwoot:</span>
                    <span class="text-emerald-400 font-semibold flex items-center gap-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Synced
                    </span>
                </div>
                <div class="pt-2 border-t border-wa-border/50 text-[11px] text-wa-muted">
                    <span>Host: <code>chatwoot.rush.com.sa</code></span>
                </div>
            </div>
        </aside>

        <!-- Main Content Area -->
        <main class="flex-1 overflow-y-auto p-6 space-y-6">

            <!-- GLOBAL DATE FILTER TOOLBAR (For Analytics & DLR) -->
            <div x-show="activeTab === 'analytics' || activeTab === 'dlr'" class="glass-panel p-3.5 rounded-2xl border border-wa-border flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-xs font-semibold text-wa-muted flex items-center gap-1.5 pr-2 border-r border-wa-border">
                        <i class="fas fa-calendar-alt text-wa-green-bright"></i>
                        <span>Date Filter:</span>
                    </span>
                    
                    <!-- Quick Presets -->
                    <button 
                        @click="setDatePreset('all')" 
                        :class="datePreset === 'all' ? 'bg-wa-green text-white font-bold' : 'bg-wa-panel text-wa-muted hover:text-white border border-wa-border'" 
                        class="px-3 py-1 rounded-xl text-xs transition-all"
                    >
                        All Time
                    </button>
                    <button 
                        @click="setDatePreset('today')" 
                        :class="datePreset === 'today' ? 'bg-wa-green text-white font-bold' : 'bg-wa-panel text-wa-muted hover:text-white border border-wa-border'" 
                        class="px-3 py-1 rounded-xl text-xs transition-all"
                    >
                        Today
                    </button>
                    <button 
                        @click="setDatePreset('yesterday')" 
                        :class="datePreset === 'yesterday' ? 'bg-wa-green text-white font-bold' : 'bg-wa-panel text-wa-muted hover:text-white border border-wa-border'" 
                        class="px-3 py-1 rounded-xl text-xs transition-all"
                    >
                        Yesterday
                    </button>
                    <button 
                        @click="setDatePreset('last7')" 
                        :class="datePreset === 'last7' ? 'bg-wa-green text-white font-bold' : 'bg-wa-panel text-wa-muted hover:text-white border border-wa-border'" 
                        class="px-3 py-1 rounded-xl text-xs transition-all"
                    >
                        Last 7 Days
                    </button>
                    <button 
                        @click="setDatePreset('last30')" 
                        :class="datePreset === 'last30' ? 'bg-wa-green text-white font-bold' : 'bg-wa-panel text-wa-muted hover:text-white border border-wa-border'" 
                        class="px-3 py-1 rounded-xl text-xs transition-all"
                    >
                        Last 30 Days
                    </button>
                </div>

                <!-- Custom Range Pickers -->
                <div class="flex items-center gap-2 flex-wrap">
                    <div class="flex items-center gap-1.5 bg-wa-panel px-2.5 py-1 rounded-xl border border-wa-border text-xs">
                        <span class="text-wa-muted text-[11px]">From:</span>
                        <input 
                            type="date" 
                            x-model="dateFrom" 
                            class="bg-transparent text-white text-xs outline-none focus:text-wa-green-bright"
                        >
                    </div>
                    <div class="flex items-center gap-1.5 bg-wa-panel px-2.5 py-1 rounded-xl border border-wa-border text-xs">
                        <span class="text-wa-muted text-[11px]">To:</span>
                        <input 
                            type="date" 
                            x-model="dateTo" 
                            class="bg-transparent text-white text-xs outline-none focus:text-wa-green-bright"
                        >
                    </div>
                    <button 
                        @click="applyCustomDateFilter()" 
                        class="px-3 py-1 bg-wa-green hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold shadow transition-all flex items-center gap-1"
                    >
                        <i class="fas fa-filter text-[10px]"></i> Apply
                    </button>
                    <template x-if="dateFrom || dateTo">
                        <button 
                            @click="clearDateFilter()" 
                            class="p-1 rounded-lg text-wa-muted hover:text-rose-400 transition-colors" 
                            title="Reset date filter"
                        >
                            <i class="fas fa-times-circle text-xs"></i>
                        </button>
                    </template>
                </div>
            </div>

            <!-- TAB 1: EXECUTIVE ANALYTICS -->
            <div x-show="activeTab === 'analytics'" class="space-y-6">
                <!-- Scope & Traffic Filter Bar -->
                <div class="flex flex-wrap items-center justify-between gap-3 bg-wa-panel/60 p-3 rounded-2xl border border-wa-border">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold text-wa-muted uppercase tracking-wider pl-1"><i class="fas fa-layer-group text-wa-green mr-1"></i> Traffic Scope:</span>
                        <div class="inline-flex p-1 bg-wa-surface rounded-xl border border-wa-border text-xs">
                            <button 
                                @click="trafficType = 'campaign'; loadAllData()"
                                :class="trafficType === 'campaign' ? 'bg-wa-green text-white font-semibold shadow' : 'text-wa-muted hover:text-white'"
                                class="px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
                            >
                                <i class="fas fa-bullhorn text-[11px]"></i> Marketing Campaign (2,142)
                            </button>
                            <button 
                                @click="trafficType = 'all'; loadAllData()"
                                :class="trafficType === 'all' ? 'bg-wa-green/30 text-white font-semibold' : 'text-wa-muted hover:text-white'"
                                class="px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
                            >
                                <i class="fas fa-network-wired text-[11px]"></i> All Channel Traffic (3,272)
                            </button>
                        </div>
                    </div>
                    <div class="text-[11px] text-wa-muted flex items-center gap-2">
                        <span class="inline-block w-2 h-2 rounded-full bg-wa-green-bright animate-pulse"></span>
                        <span x-text="trafficType === 'campaign' ? 'Viewing isolated Watan96 Campaign broadcast (support chats excluded)' : 'Viewing total channel volume including customer support'"></span>
                    </div>
                </div>

                <!-- KPI Scorecard Grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                    <!-- Sent Card -->
                    <div class="glass-panel p-5 rounded-2xl border border-wa-border relative overflow-hidden">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-wa-muted uppercase tracking-wider" x-text="trafficType === 'campaign' ? 'Campaign Outbound' : 'Outbound Sent'"></span>
                            <div class="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
                                <i class="fas fa-paper-plane text-xs"></i>
                            </div>
                        </div>
                        <div class="mt-3 flex items-baseline gap-2">
                            <span class="text-2xl font-extrabold text-white" x-text="stats.total_sent || 0"></span>
                            <span class="text-xs text-wa-muted">messages</span>
                        </div>
                        <div class="mt-2 text-[11px] text-blue-400 flex items-center gap-1 truncate">
                            <i class="fas fa-bullhorn"></i> <span x-text="trafficType === 'campaign' ? 'Template: 96_sar (Watan96)' : 'Official WhatsApp API'"></span>
                        </div>
                    </div>

                    <!-- Delivered Card -->
                    <div class="glass-panel p-5 rounded-2xl border border-wa-border relative overflow-hidden">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-wa-muted uppercase tracking-wider">Delivery Rate</span>
                            <div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                                <i class="fas fa-check-double text-xs"></i>
                            </div>
                        </div>
                        <div class="mt-3 flex items-baseline gap-2">
                            <span class="text-2xl font-extrabold text-emerald-400" x-text="(stats.delivery_rate || 98.5) + '%'"></span>
                            <span class="text-xs text-wa-muted" x-text="'(' + (stats.total_delivered || 0) + ' delivered)'"></span>
                        </div>
                        <div class="mt-2 text-[11px] text-emerald-400 flex items-center gap-1">
                            <i class="fas fa-bolt"></i> Real-time DLR Verified
                        </div>
                    </div>

                    <!-- Inbound Received -->
                    <div class="glass-panel p-5 rounded-2xl border border-wa-border relative overflow-hidden">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-wa-muted uppercase tracking-wider">Inbound Replies</span>
                            <div class="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
                                <i class="fas fa-inbox text-xs"></i>
                            </div>
                        </div>
                        <div class="mt-3 flex items-baseline gap-2">
                            <span class="text-2xl font-extrabold text-white" x-text="stats.total_inbound || 0"></span>
                            <span class="text-xs text-wa-muted">customer chats</span>
                        </div>
                        <div class="mt-2 text-[11px] text-purple-400 flex items-center gap-1">
                            <i class="fas fa-sync-alt"></i> Synced to Chatwoot
                        </div>
                    </div>

                    <!-- Active 24h Sessions -->
                    <div class="glass-panel p-5 rounded-2xl border border-wa-border relative overflow-hidden">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-wa-muted uppercase tracking-wider">Active 24h Sessions</span>
                            <div class="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                                <i class="fas fa-clock text-xs"></i>
                            </div>
                        </div>
                        <div class="mt-3 flex items-baseline gap-2">
                            <span class="text-2xl font-extrabold text-cyan-400" x-text="stats.active_24h_sessions || 0"></span>
                            <span class="text-xs text-wa-muted">open sessions</span>
                        </div>
                        <div class="mt-2 text-[11px] text-cyan-400 flex items-center gap-1">
                            <i class="fas fa-comments"></i> 24h Meta Window
                        </div>
                    </div>

                    <!-- Free Monthly Service Messages (Meta Oct 1, 2026 Tier) -->
                    <div class="glass-panel p-5 rounded-2xl border border-wa-border relative overflow-hidden bg-gradient-to-b from-emerald-500/5 to-transparent">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Free Service Tier</span>
                            <div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center" title="1,000 free delivered service messages per month (Oct 1, 2026 Meta Policy)">
                                <i class="fas fa-shield-alt text-xs"></i>
                            </div>
                        </div>
                        <div class="mt-3 flex items-baseline gap-1.5">
                            <span class="text-2xl font-extrabold text-white" x-text="stats.service_quota?.free_tier_used || 0"></span>
                            <span class="text-xs text-wa-muted">/ 1,000</span>
                        </div>
                        <!-- Progress bar -->
                        <div class="w-full bg-wa-panel rounded-full h-1.5 mt-2.5 overflow-hidden border border-wa-border">
                            <div 
                                class="h-full rounded-full transition-all duration-300"
                                :class="(stats.service_quota?.free_tier_used || 0) >= 1000 ? 'bg-rose-500' : ((stats.service_quota?.free_tier_used || 0) > 800 ? 'bg-amber-400' : 'bg-emerald-400')"
                                :style="'width: ' + Math.min(100, (((stats.service_quota?.free_tier_used || 0) / 1000) * 100)) + '%'"
                            ></div>
                        </div>
                        <div class="mt-2 text-[10px] flex items-center justify-between">
                            <span class="text-wa-muted" x-text="(stats.service_quota?.free_tier_remaining || 1000) + ' remaining free'"></span>
                            <span 
                                class="px-1.5 py-0.2 rounded font-bold"
                                :class="(stats.service_quota?.billable_service_messages || 0) > 0 ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'"
                                x-text="(stats.service_quota?.billable_service_messages || 0) > 0 ? ((stats.service_quota.billable_service_messages) + ' regular') : 'Free Tier Active'"
                            ></span>
                        </div>
                    </div>

                    <!-- Unifonic Cost / Spend -->
                    <div class="glass-panel p-5 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-amber-500/5 to-transparent relative overflow-hidden">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-amber-300 uppercase tracking-wider" x-text="trafficType === 'campaign' ? 'Campaign Spend' : 'Unifonic Cost'"></span>
                            <div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                                <i class="fas fa-coins text-xs"></i>
                            </div>
                        </div>
                        <div class="mt-3 flex items-baseline gap-1.5">
                            <span class="text-2xl font-extrabold text-amber-400" x-text="stats.total_cost || '0.00'"></span>
                            <span class="text-xs font-bold text-amber-300/80" x-text="stats.currency || 'SAR'"></span>
                        </div>
                        <div class="mt-2 text-[11px] text-amber-300/80 flex items-center justify-between">
                            <span><i class="fas fa-calculator mr-1"></i> Rate: <strong class="text-white" x-text="(stats.cost_per_message || '0.15') + ' ' + (stats.currency || 'SAR')"></strong></span>
                        </div>
                    </div>
                </div>

                <!-- Charts Section -->
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <!-- Traffic Volume Bar Chart -->
                    <div class="lg:col-span-2 glass-panel p-6 rounded-2xl border border-wa-border space-y-4">
                        <div class="flex items-center justify-between">
                            <div>
                                <h3 class="font-bold text-sm text-white">Traffic & Broadcast Volume</h3>
                                <p class="text-xs text-wa-muted">Filtered throughput of inbound responses & campaign deliveries</p>
                            </div>
                            <span class="text-xs bg-wa-panel px-3 py-1 rounded-xl border border-wa-border text-wa-green-bright font-semibold">Live Feed</span>
                        </div>
                        <div class="h-64 relative">
                            <canvas id="trafficChart"></canvas>
                        </div>
                    </div>

                    <!-- Delivery Status Donut -->
                    <div class="glass-panel p-6 rounded-2xl border border-wa-border space-y-4">
                        <div class="flex items-center justify-between">
                            <h3 class="font-bold text-sm text-white">Delivery Quality Breakdown</h3>
                            <span class="text-xs text-wa-muted">Selected Range</span>
                        </div>
                        <div class="h-56 relative flex items-center justify-center">
                            <canvas id="statusDonutChart"></canvas>
                        </div>
                        <div class="grid grid-cols-3 gap-2 pt-2 border-t border-wa-border text-center text-xs">
                            <div>
                                <span class="text-wa-muted block text-[10px]">Read</span>
                                <strong class="text-sky-400" x-text="stats.read_count || 0"></strong>
                            </div>
                            <div>
                                <span class="text-wa-muted block text-[10px]">Delivered</span>
                                <strong class="text-emerald-400" x-text="stats.delivered_count || 0"></strong>
                            </div>
                            <div>
                                <span class="text-wa-muted block text-[10px]">Failed</span>
                                <strong class="text-rose-400" x-text="stats.failed_count || 0"></strong>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- TAB 2: BULK CAMPAIGN LAUNCHER -->
            <div x-show="activeTab === 'campaigns'" class="space-y-6" x-cloak>
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-lg font-bold text-white">WhatsApp Broadcast & Campaign Launcher</h2>
                        <p class="text-xs text-wa-muted">Send mass WhatsApp promotions & notifications with automatic Chatwoot thread creation.</p>
                    </div>
                    <button 
                        @click="showNewCampaignModal = true" 
                        class="px-4 py-2 bg-gradient-to-r from-wa-green to-emerald-600 hover:from-emerald-500 hover:to-wa-green text-white font-semibold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-wa-green/20 transition-all"
                    >
                        <i class="fas fa-plus"></i>
                        <span>Create Broadcast Campaign</span>
                    </button>
                </div>

                <!-- Campaign History & Progress Table -->
                <div class="glass-panel rounded-2xl border border-wa-border overflow-hidden">
                    <div class="p-4 border-b border-wa-border flex items-center justify-between bg-wa-panel/50">
                        <span class="text-xs font-bold text-white uppercase tracking-wider">Broadcast Campaigns</span>
                        <span class="text-xs text-wa-muted" x-text="campaigns.length + ' campaigns recorded'"></span>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-wa-panel text-wa-muted uppercase text-[10px] tracking-wider border-b border-wa-border">
                                <tr>
                                    <th class="py-3 px-4">Campaign Name</th>
                                    <th class="py-3 px-4">Recipients</th>
                                    <th class="py-3 px-4">Est. Cost</th>
                                    <th class="py-3 px-4">Sent</th>
                                    <th class="py-3 px-4">Failed</th>
                                    <th class="py-3 px-4">Progress</th>
                                    <th class="py-3 px-4">Status</th>
                                    <th class="py-3 px-4">Date</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-wa-border">
                                <template x-for="c in campaigns" :key="c.id">
                                    <tr class="hover:bg-wa-surface/40 transition-colors">
                                        <td class="py-3.5 px-4 font-semibold text-white" x-text="c.name"></td>
                                        <td class="py-3.5 px-4 font-mono text-wa-muted" x-text="c.total_recipients"></td>
                                        <td class="py-3.5 px-4 font-mono font-bold text-amber-300" x-text="(c.estimated_cost ? c.estimated_cost + ' ' + (c.currency || 'SAR') : ((c.total_recipients * (stats.cost_per_message || 0.15)).toFixed(2) + ' ' + (stats.currency || 'SAR')))"></td>
                                        <td class="py-3.5 px-4 font-mono text-emerald-400 font-bold" x-text="c.sent_count"></td>
                                        <td class="py-3.5 px-4 font-mono text-rose-400" x-text="c.failed_count"></td>
                                        <td class="py-3.5 px-4 w-44">
                                            <div class="flex items-center gap-2">
                                                <div class="flex-1 bg-wa-panel rounded-full h-2 overflow-hidden border border-wa-border">
                                                    <div class="bg-wa-green h-full rounded-full transition-all duration-300" :style="'width: ' + c.progress_pct + '%'"></div>
                                                </div>
                                                <span class="text-[10px] font-mono text-wa-muted" x-text="c.progress_pct + '%'"></span>
                                            </div>
                                        </td>
                                        <td class="py-3.5 px-4">
                                            <span 
                                                class="px-2 py-0.5 rounded text-[10px] font-bold" 
                                                :class="{
                                                    'bg-emerald-500/10 text-emerald-400': c.status === 'COMPLETED',
                                                    'bg-blue-500/10 text-blue-400 animate-pulse': c.status === 'RUNNING',
                                                    'bg-amber-500/10 text-amber-400': c.status === 'QUEUED',
                                                    'bg-rose-500/10 text-rose-400': c.status === 'STOPPED'
                                                }"
                                                x-text="c.status"
                                            ></span>
                                        </td>
                                        <td class="py-3.5 px-4 text-wa-muted text-[11px]" x-text="formatDate(c.created_at)"></td>
                                    </tr>
                                </template>
                                <tr x-show="campaigns.length === 0">
                                    <td colspan="8" class="py-8 text-center text-wa-muted text-xs">
                                        No campaigns launched yet. Click <strong>"Create Broadcast Campaign"</strong> above to launch your first blast.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- TAB 3: TEMPLATE STUDIO (WITH PRE-APPROVED TEMPLATES) -->
            <div x-show="activeTab === 'templates'" class="space-y-6" x-cloak>
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 class="text-lg font-bold text-white flex items-center gap-2">
                            <span>WhatsApp Message Templates &amp; Studio</span>
                            <span class="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-bold">Meta / Unifonic Sync</span>
                        </h2>
                        <p class="text-xs text-wa-muted">Pre-approved &amp; in-review WhatsApp templates. Ready for broadcasts, live chat, and API automation.</p>
                    </div>
                    <div class="flex items-center gap-2.5">
                        <button 
                            @click="openCreateTemplateModal()" 
                            class="px-3.5 py-2 bg-gradient-to-r from-wa-green to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-2"
                        >
                            <i class="fas fa-plus-circle"></i>
                            <span>Create Template via API</span>
                        </button>
                        <button 
                            @click="loadTemplates(true)" 
                            class="px-3.5 py-2 bg-wa-panel hover:bg-wa-surface text-white rounded-xl text-xs font-semibold border border-wa-border flex items-center gap-2 transition-all shadow"
                            :disabled="isLoadingTemplates"
                        >
                            <i class="fas fa-sync-alt text-wa-green-bright" :class="{'fa-spin': isLoadingTemplates}"></i>
                            <span>Sync from Unifonic</span>
                        </button>
                    </div>
                </div>

                <!-- Template Status & Search Filter Bar -->
                <div class="flex flex-wrap items-center justify-between gap-3 p-3 bg-wa-panel/60 rounded-xl border border-wa-border">
                    <div class="flex flex-wrap items-center gap-1.5">
                        <button 
                            @click="templateStatusFilter = 'ALL'" 
                            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                            :class="templateStatusFilter === 'ALL' ? 'bg-wa-surface text-white font-bold border border-wa-border shadow' : 'text-wa-muted hover:text-white'"
                        >
                            All (<span x-text="templates.length"></span>)
                        </button>
                        <button 
                            @click="templateStatusFilter = 'APPROVED'" 
                            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                            :class="templateStatusFilter === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold shadow' : 'text-wa-muted hover:text-emerald-400'"
                        >
                            <i class="fas fa-check-circle text-[10px]"></i>
                            <span>Approved (<span x-text="countTemplatesByStatus('APPROVED')"></span>)</span>
                        </button>
                        <button 
                            @click="templateStatusFilter = 'IN_REVIEW'" 
                            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                            :class="templateStatusFilter === 'IN_REVIEW' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 font-bold shadow' : 'text-wa-muted hover:text-amber-400'"
                        >
                            <i class="fas fa-hourglass-half text-[10px]"></i>
                            <span>In Review / Pending (<span x-text="countTemplatesByStatus('IN_REVIEW')"></span>)</span>
                        </button>
                        <button 
                            @click="templateStatusFilter = 'REJECTED'" 
                            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                            :class="templateStatusFilter === 'REJECTED' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold shadow' : 'text-wa-muted hover:text-rose-400'"
                        >
                            <i class="fas fa-times-circle text-[10px]"></i>
                            <span>Rejected (<span x-text="countTemplatesByStatus('REJECTED')"></span>)</span>
                        </button>
                    </div>

                    <div class="w-full sm:w-64">
                        <input 
                            type="text" 
                            x-model="templateSearch" 
                            placeholder="Search templates..." 
                            class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-1.5 text-xs text-wa-text focus:outline-none focus:border-wa-green"
                        >
                    </div>
                </div>

                <!-- Template Cards Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <template x-for="t in filteredTemplates()" :key="t.id || t.name">
                        <div class="glass-panel p-5 rounded-2xl border border-wa-border flex flex-col justify-between hover:border-wa-green/50 transition-all shadow-lg group">
                            <div class="space-y-3">
                                <!-- Card Header with Interactive Status Switcher -->
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <div class="w-7 h-7 rounded-lg bg-wa-panel border border-wa-border flex items-center justify-center text-wa-green-bright text-xs shrink-0">
                                            <i class="fab fa-whatsapp"></i>
                                        </div>
                                        <span class="font-bold text-xs text-white font-mono truncate" x-text="t.name"></span>
                                    </div>

                                    <!-- Interactive Status Badge & Switcher Dropdown -->
                                    <div class="relative shrink-0" x-data="{ showStatusDropdown: false }">
                                        <button 
                                            @click="showStatusDropdown = !showStatusDropdown" 
                                            class="px-2 py-0.5 rounded text-[10px] font-extrabold border flex items-center gap-1 cursor-pointer transition-all hover:scale-105 shadow"
                                            :class="getStatusBadgeClass(t.status)"
                                            title="Click to change review status"
                                        >
                                            <i :class="getStatusIconClass(t.status)"></i>
                                            <span x-text="t.status || 'IN_REVIEW'"></span>
                                            <i class="fas fa-chevron-down text-[8px] opacity-60 ml-0.5"></i>
                                        </button>
                                        <div 
                                            x-show="showStatusDropdown" 
                                            @click.away="showStatusDropdown = false" 
                                            class="absolute right-0 top-full mt-1.5 z-40 bg-wa-panel border border-wa-border rounded-xl p-1.5 shadow-2xl flex flex-col gap-1 min-w-[140px]"
                                            x-cloak
                                        >
                                            <div class="px-2 py-1 text-[9px] text-wa-muted font-bold border-b border-wa-border uppercase">Update Status</div>
                                            <button 
                                                @click="changeTemplateStatus(t.name, 'APPROVED'); showStatusDropdown = false" 
                                                class="px-2.5 py-1 text-[11px] text-left rounded-lg hover:bg-wa-surface text-emerald-400 font-semibold flex items-center gap-2"
                                            >
                                                <i class="fas fa-check-circle"></i> Approved
                                            </button>
                                            <button 
                                                @click="changeTemplateStatus(t.name, 'IN_REVIEW'); showStatusDropdown = false" 
                                                class="px-2.5 py-1 text-[11px] text-left rounded-lg hover:bg-wa-surface text-amber-400 font-semibold flex items-center gap-2"
                                            >
                                                <i class="fas fa-hourglass-half"></i> In Review
                                            </button>
                                            <button 
                                                @click="changeTemplateStatus(t.name, 'REJECTED'); showStatusDropdown = false" 
                                                class="px-2.5 py-1 text-[11px] text-left rounded-lg hover:bg-wa-surface text-rose-400 font-semibold flex items-center gap-2"
                                            >
                                                <i class="fas fa-times-circle"></i> Rejected
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <!-- Meta Details Badges -->
                                <div class="flex items-center gap-2 text-[10px]">
                                    <span class="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-semibold uppercase" x-text="t.category || 'MARKETING'"></span>
                                    <span class="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-semibold uppercase" x-text="'LANG: ' + (t.language || 'AR')"></span>
                                    <span class="text-wa-muted font-mono" x-text="'ID: ' + (t.id ? t.id.slice(-6) : 'N/A')"></span>
                                </div>

                                <!-- Body Text Preview -->
                                <div class="p-3 bg-wa-panel/70 rounded-xl border border-wa-border/60 text-xs text-wa-text font-arabic leading-relaxed min-h-[90px] whitespace-pre-line" dir="rtl" x-text="getTemplateBodyText(t)">
                                </div>

                                <!-- Buttons Preview if any -->
                                <template x-if="getTemplateButtons(t).length > 0">
                                    <div class="flex flex-wrap gap-1.5 pt-1">
                                        <template x-for="btn in getTemplateButtons(t)" :key="btn.text">
                                            <span class="px-2.5 py-1 rounded-lg bg-wa-surface border border-wa-border text-[11px] text-sky-400 font-semibold flex items-center gap-1.5">
                                                <i class="fas fa-external-link-alt text-[9px]" x-show="btn.type === 'URL'"></i>
                                                <i class="fas fa-reply text-[9px]" x-show="btn.type !== 'URL'"></i>
                                                <span x-text="btn.text"></span>
                                            </span>
                                        </template>
                                    </div>
                                </template>
                            </div>

                            <!-- Card Actions -->
                            <div class="pt-4 border-t border-wa-border flex items-center gap-2 mt-4">
                                <button 
                                    @click="simulateTemplateOnPhone(t)" 
                                    class="flex-1 py-1.5 bg-wa-surface hover:bg-wa-panel text-white rounded-xl text-xs font-semibold border border-wa-border transition-colors flex items-center justify-center gap-1.5"
                                >
                                    <i class="fas fa-mobile-alt text-wa-green-bright"></i>
                                    <span>Simulate</span>
                                </button>
                                <button 
                                    @click="useApprovedTemplateInCampaign(t)" 
                                    class="flex-1 py-1.5 bg-wa-green hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5"
                                >
                                    <i class="fas fa-paper-plane"></i>
                                    <span>Use in Blast</span>
                                </button>
                                <button 
                                    @click="downloadTemplateCSV(t)" 
                                    class="p-2 bg-wa-panel hover:bg-wa-surface text-wa-muted hover:text-emerald-400 rounded-xl text-xs border border-wa-border transition-colors"
                                    title="Download CSV Template with Variables"
                                >
                                    <i class="fas fa-file-csv"></i>
                                </button>
                                <button 
                                    @click="copyUnifonicConsoleDetails(t)" 
                                    class="p-2 bg-wa-panel hover:bg-wa-surface text-wa-muted hover:text-sky-400 rounded-xl text-xs border border-wa-border transition-colors"
                                    title="Copy for Unifonic Console"
                                >
                                    <i class="fas fa-copy"></i>
                                </button>
                            </div>
                        </div>
                    </template>
                </div>

                <!-- Live Smartphone Preview & Custom Editor Section -->
                <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pt-6 border-t border-wa-border">
                    <!-- Template Editor Form -->
                    <div class="lg:col-span-7 glass-panel p-6 rounded-2xl border border-wa-border space-y-5">
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted">Active Selected Template</label>
                            <input 
                                type="text" 
                                x-model="templateForm.name" 
                                placeholder="e.g. 96_sar" 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl px-4 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green font-mono"
                            >
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-wa-muted">Category</label>
                                <select x-model="templateForm.category" class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green">
                                    <option value="MARKETING">Marketing (Promotional Offers)</option>
                                    <option value="UTILITY">Utility (Receipts &amp; Notifications)</option>
                                    <option value="AUTHENTICATION">Authentication (OTPs)</option>
                                </select>
                            </div>
                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-wa-muted">Language</label>
                                <select x-model="templateForm.language" class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green">
                                    <option value="ar">Arabic (ar)</option>
                                    <option value="en">English (en)</option>
                                </select>
                            </div>
                        </div>

                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted flex items-center justify-between">
                                <span>Message Body Content</span>
                                <span class="text-[10px] text-wa-green-bright font-normal cursor-pointer" @click="insertVariable()">+ Insert Variable {{1}}</span>
                            </label>
                            <textarea 
                                x-model="templateForm.body" 
                                rows="6" 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl p-3.5 text-xs text-wa-text focus:outline-none focus:border-wa-green leading-relaxed font-arabic"
                                placeholder="اكتب نص الرسالة هنا..."
                                dir="rtl"
                            ></textarea>
                        </div>

                        <!-- Header Media URL + Direct VPS Upload + Choose from Vault -->
                        <div class="space-y-1">
                            <div class="flex items-center justify-between">
                                <label class="text-xs font-semibold text-wa-muted">Header Media URL (Image / Banner)</label>
                                <div class="flex items-center gap-3">
                                    <button type="button" @click="openVaultPicker('template')" class="text-[11px] text-sky-400 hover:underline cursor-pointer flex items-center gap-1">
                                        <i class="fas fa-photo-video"></i>
                                        <span>Choose from Vault</span>
                                    </button>
                                    <label class="text-[11px] text-wa-green-bright hover:underline cursor-pointer flex items-center gap-1">
                                        <i class="fas fa-cloud-upload-alt"></i>
                                        <span>Upload New</span>
                                        <input type="file" class="hidden" accept="image/*,video/*,application/pdf" @change="uploadMediaFile($event, 'template')">
                                    </label>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <input 
                                    type="text" 
                                    x-model="templateForm.mediaUrl" 
                                    placeholder="https://whatsapp.rush.com.sa/uploads/banner.jpg" 
                                    class="flex-1 bg-wa-panel border border-wa-border rounded-xl px-4 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green font-mono"
                                >
                                <template x-if="templateForm.mediaUrl">
                                    <button @click="templateForm.mediaUrl = ''" class="p-2 text-wa-muted hover:text-rose-400" title="Remove Media">
                                        <i class="fas fa-times"></i>
                                    </button>
                                </template>
                            </div>
                            <template x-if="isUploadingMedia">
                                <div class="text-[11px] text-wa-green-bright flex items-center gap-1.5 pt-1">
                                    <i class="fas fa-spinner fa-spin"></i> Uploading to VPS storage...
                                </div>
                            </template>
                        </div>

                        <div class="pt-2 flex items-center gap-3">
                            <button 
                                @click="useTemplateInCampaign()" 
                                class="flex-1 py-2.5 bg-wa-green hover:bg-emerald-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-wa-green/20 transition-all flex items-center justify-center gap-2"
                            >
                                <i class="fas fa-paper-plane"></i>
                                <span>Use this Template in Broadcast Campaign</span>
                            </button>
                            <button 
                                type="button" 
                                @click="downloadTemplateCSV(selectedTemplate || {name: templateForm.name, body: templateForm.body})" 
                                class="px-4 py-2.5 bg-wa-panel hover:bg-wa-surface border border-wa-border text-white hover:text-emerald-400 rounded-xl text-xs font-semibold transition-all flex items-center gap-2"
                                title="Download sample CSV formatted with variables for this template"
                            >
                                <i class="fas fa-file-csv text-emerald-400"></i>
                                <span>Download CSV</span>
                            </button>
                        </div>
                    </div>

                    <!-- Live Smartphone Preview -->
                    <div class="lg:col-span-5 flex flex-col items-center justify-center">
                        <div class="phone-mockup">
                            <!-- Phone Top Notch -->
                            <div class="h-6 bg-wa-surface w-full flex items-center justify-between px-6 text-[10px] text-wa-muted">
                                <span>09:41</span>
                                <div class="flex items-center gap-1.5">
                                    <i class="fas fa-signal"></i>
                                    <i class="fas fa-wifi"></i>
                                    <i class="fas fa-battery-full text-wa-green-bright"></i>
                                </div>
                            </div>

                            <!-- WhatsApp Header -->
                            <div class="bg-wa-panel px-3 py-2 flex items-center gap-2.5 border-b border-wa-border shadow">
                                <i class="fas fa-arrow-left text-xs text-wa-muted"></i>
                                <div class="w-8 h-8 rounded-full bg-rush-red flex items-center justify-center text-white font-bold text-xs">
                                    R
                                </div>
                                <div class="flex-1 leading-tight">
                                    <h4 class="font-bold text-xs text-white flex items-center gap-1">
                                        RushWash
                                        <i class="fas fa-check-circle text-wa-green-bright text-[10px]"></i>
                                    </h4>
                                    <span class="text-[10px] text-wa-muted">Official Business Account</span>
                                </div>
                            </div>

                            <!-- Chat Area -->
                            <div class="flex-1 p-3.5 overflow-y-auto space-y-3 flex flex-col justify-end" style="background-color: var(--background);">
                                <div class="self-end max-w-[92%] wa-bubble-out p-3 text-xs shadow-md space-y-2">
                                    <!-- Image Preview if available -->
                                    <template x-if="templateForm.mediaUrl">
                                        <div class="rounded-lg overflow-hidden bg-black/30 max-h-36 mb-1.5 border border-white/10">
                                            <img :src="templateForm.mediaUrl" alt="Media" class="w-full h-full object-cover">
                                        </div>
                                    </template>

                                    <!-- Rendered Body -->
                                    <p class="font-arabic leading-relaxed whitespace-pre-line text-right" dir="rtl" x-text="renderPreviewBody()"></p>

                                    <!-- Rendered Template Buttons in Preview -->
                                    <template x-if="templateForm.buttons && templateForm.buttons.length > 0">
                                        <div class="pt-2 border-t border-white/10 flex flex-col gap-1.5">
                                            <template x-for="btn in templateForm.buttons" :key="btn.text">
                                                <div class="py-1.5 px-3 bg-black/20 hover:bg-black/30 rounded-lg text-center font-bold text-[11px] text-emerald-300 border border-white/10 flex items-center justify-center gap-1.5">
                                                    <i class="fas fa-external-link-alt text-[9px]" x-show="btn.type === 'URL'"></i>
                                                    <span x-text="btn.text"></span>
                                                </div>
                                            </template>
                                        </div>
                                    </template>

                                    <div class="flex items-center justify-end gap-1 text-[9px] text-wa-muted pt-1">
                                        <span>Just now</span>
                                        <i class="fas fa-check-double text-sky-400 text-[10px]"></i>
                                    </div>
                                </div>
                            </div>

                            <!-- Footer Input -->
                            <div class="p-2 bg-wa-panel flex items-center gap-2 border-t border-wa-border">
                                <div class="flex-1 bg-wa-surface rounded-full px-3 py-1.5 text-[11px] text-wa-muted">Type a reply...</div>
                                <div class="w-7 h-7 rounded-full bg-wa-green flex items-center justify-center text-white text-xs">
                                    <i class="fas fa-microphone"></i>
                                </div>
                            </div>
                        </div>
                        <span class="text-xs text-wa-muted mt-3 flex items-center gap-1.5">
                            <i class="fas fa-mobile-alt text-wa-green-bright"></i> Live WhatsApp iOS / Android Render
                        </span>
                    </div>
                </div>
            </div>

            <!-- TAB 4: LIVE CONVERSATIONS -->
            <div x-show="activeTab === 'chats'" class="space-y-6" x-cloak>
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-lg font-bold text-white">Live WhatsApp Conversations</h2>
                        <p class="text-xs text-wa-muted">All customer chat threads are synchronized in real-time with Chatwoot.</p>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[600px] glass-panel rounded-2xl border border-wa-border overflow-hidden">
                    <!-- Conversations List -->
                    <div class="lg:col-span-4 border-r border-wa-border flex flex-col bg-wa-panel/40">
                        <div class="p-3 border-b border-wa-border">
                            <input 
                                type="text" 
                                x-model="chatSearch" 
                                placeholder="Search chats..." 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-1.5 text-xs text-wa-text focus:outline-none focus:border-wa-green"
                            >
                        </div>
                        <div class="flex-1 overflow-y-auto divide-y divide-wa-border">
                            <template x-for="conv in filteredConversations()" :key="conv.phone">
                                <div 
                                    @click="selectChat(conv)" 
                                    :class="selectedConv?.phone === conv.phone ? 'bg-wa-surface border-l-4 border-wa-green' : 'hover:bg-wa-surface/30'"
                                    class="p-3.5 cursor-pointer transition-all flex items-start gap-3"
                                >
                                    <div class="w-9 h-9 rounded-full bg-gradient-to-br from-wa-green to-emerald-700 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow">
                                        <i class="fab fa-whatsapp"></i>
                                    </div>
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center justify-between mb-1">
                                            <span class="font-bold text-xs text-white truncate" x-text="'+' + conv.phone"></span>
                                            <span class="text-[10px] text-wa-muted" x-text="formatTime(conv.last_timestamp)"></span>
                                        </div>
                                        <p class="text-xs text-wa-muted truncate font-arabic" x-text="conv.last_message || 'Media / Image'"></p>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- Chat Message View -->
                    <div class="lg:col-span-8 flex flex-col justify-between bg-wa-deep/50">
                        <template x-if="selectedConv">
                            <div class="flex-1 flex flex-col justify-between overflow-hidden">
                                <!-- Chat Header -->
                                <div class="p-4 bg-wa-panel border-b border-wa-border flex items-center justify-between">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 rounded-full bg-wa-green flex items-center justify-center text-white text-xs font-bold">
                                            <i class="fab fa-whatsapp"></i>
                                        </div>
                                        <div>
                                            <h3 class="font-bold text-xs text-white" x-text="'+' + selectedConv.phone"></h3>
                                            <span class="text-[10px] text-emerald-400 flex items-center gap-1">
                                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Active WhatsApp Session
                                            </span>
                                        </div>
                                    </div>
                                    <a :href="'https://chatwoot.rush.com.sa'" target="_blank" class="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5">
                                        <i class="fas fa-external-link-alt text-[10px]"></i> Reply in Chatwoot
                                    </a>
                                </div>

                                <!-- Messages Scroll Area -->
                                <div class="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col justify-end">
                                    <template x-for="m in activeChatMessages" :key="m.message_id || Math.random()">
                                        <div 
                                            :class="m.direction === 'outbound' || m.event_type === 'outbound_message' ? 'self-end wa-bubble-out' : 'self-start wa-bubble-in'"
                                            class="max-w-[75%] p-3 text-xs shadow-md space-y-1.5"
                                        >
                                            <!-- Attachment Image if present -->
                                            <template x-if="m.media_url || (m.attachments && m.attachments.length > 0)">
                                                <div class="rounded-lg overflow-hidden bg-black/30 max-h-48 mb-1 border border-white/10">
                                                    <img :src="m.media_url || m.attachments[0].url || m.attachments[0].data_url" alt="Media Attachment" class="w-full h-full object-cover">
                                                </div>
                                            </template>

                                            <p class="font-arabic leading-relaxed whitespace-pre-line" x-text="m.content"></p>
                                            <div class="flex items-center justify-end gap-1 text-[9px] text-wa-muted">
                                                <span x-text="formatTime(m.received_at || m.timestamp)"></span>
                                                <template x-if="m.direction === 'outbound' || m.event_type === 'outbound_message'">
                                                    <i class="fas fa-check-double text-sky-400 text-[10px]"></i>
                                                </template>
                                            </div>
                                        </div>
                                    </template>
                                </div>

                                <!-- Instant Reply Bar with Attachment Upload -->
                                <div class="p-3 bg-wa-panel border-t border-wa-border space-y-2">
                                    <!-- Pending Chat Attachment Preview -->
                                    <template x-if="chatAttachmentUrl">
                                        <div class="flex items-center gap-2 p-2 rounded-xl bg-wa-surface border border-wa-border max-w-sm">
                                            <img :src="chatAttachmentUrl" alt="Attachment" class="w-10 h-10 object-cover rounded-lg">
                                            <div class="flex-1 min-w-0">
                                                <span class="text-[11px] font-semibold text-white block truncate">Media attached</span>
                                                <span class="text-[10px] text-wa-muted truncate block font-mono" x-text="chatAttachmentUrl"></span>
                                            </div>
                                            <button @click="chatAttachmentUrl = ''" class="text-wa-muted hover:text-rose-400 p-1">
                                                <i class="fas fa-times"></i>
                                            </button>
                                        </div>
                                    </template>

                                    <div class="flex items-center gap-2">
                                        <!-- Attach Media Buttons (Pick from Vault or Upload) -->
                                        <button type="button" @click="openVaultPicker('chat')" class="p-2.5 bg-wa-surface hover:bg-wa-border text-sky-400 hover:text-white rounded-xl text-xs cursor-pointer transition-colors" title="Choose Media from VPS Vault">
                                            <i class="fas fa-photo-video"></i>
                                        </button>
                                        <label class="p-2.5 bg-wa-surface hover:bg-wa-border text-wa-muted hover:text-white rounded-xl text-xs cursor-pointer transition-colors" title="Upload Media to VPS">
                                            <i class="fas fa-paperclip" :class="{'fa-spin': isUploadingMedia}"></i>
                                            <input type="file" class="hidden" accept="image/*,video/*,application/pdf" @change="uploadMediaFile($event, 'chat')">
                                        </label>

                                        <input 
                                            type="text" 
                                            x-model="replyText" 
                                            @keyup.enter="sendDirectReply()" 
                                            placeholder="Type message to customer..." 
                                            class="flex-1 bg-wa-surface border border-wa-border rounded-xl px-4 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green font-arabic"
                                        >
                                        <button 
                                            @click="sendDirectReply()" 
                                            class="px-4 py-2 bg-wa-green hover:bg-emerald-600 text-white font-bold rounded-xl text-xs transition-all shadow flex items-center gap-1.5"
                                        >
                                            <i class="fas fa-paper-plane"></i>
                                            <span>Send</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </template>

                        <template x-if="!selectedConv">
                            <div class="flex-1 flex flex-col items-center justify-center text-wa-muted text-xs space-y-2">
                                <i class="fab fa-whatsapp text-4xl text-wa-border"></i>
                                <span>Select a customer from the left list to view conversation history.</span>
                            </div>
                        </template>
                    </div>
                </div>
            </div>

            <!-- TAB 5: MEDIA VAULT (HOSTED ON VPS) -->
            <div x-show="activeTab === 'media'" class="space-y-6" x-cloak>
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 class="text-lg font-bold text-white flex items-center gap-2">
                            <span>VPS Media Vault &amp; Asset Uploader</span>
                            <span class="text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2.5 py-0.5 rounded-full font-bold">Direct HTTPS Links</span>
                        </h2>
                        <p class="text-xs text-wa-muted">Upload promotional banners, flyers, PDFs and videos directly to the VPS storage for instant WhatsApp broadcast links.</p>
                    </div>
                    
                    <!-- Direct File Uploader Button -->
                    <label class="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold rounded-xl text-xs flex items-center gap-2 shadow-lg shadow-purple-500/20 cursor-pointer transition-all">
                        <i class="fas fa-cloud-upload-alt" :class="{'fa-spin': isUploadingMedia}"></i>
                        <span x-text="isUploadingMedia ? 'Uploading...' : 'Upload New Media to VPS'"></span>
                        <input type="file" class="hidden" accept="image/*,video/*,application/pdf" @change="uploadMediaFile($event, 'vault')">
                    </label>
                </div>

                <!-- Upload Drag & Drop Box -->
                <div class="glass-panel p-6 rounded-2xl border-2 border-dashed border-wa-border hover:border-wa-green/60 transition-all text-center space-y-3">
                    <div class="w-12 h-12 rounded-full bg-wa-panel border border-wa-border text-wa-green-bright flex items-center justify-center mx-auto text-lg">
                        <i class="fas fa-image"></i>
                    </div>
                    <div>
                        <h4 class="text-xs font-bold text-white">Click or Drag &amp; Drop media assets here</h4>
                        <p class="text-[11px] text-wa-muted">Supports JPG, PNG, WEBP, GIF, PDF, and MP4. Hosted at <code>https://whatsapp.rush.com.sa/uploads/...</code></p>
                    </div>
                    <label class="inline-block px-4 py-1.5 bg-wa-panel hover:bg-wa-surface text-white rounded-xl text-xs font-semibold border border-wa-border cursor-pointer transition-colors">
                        <span>Select File from Device</span>
                        <input type="file" class="hidden" accept="image/*,video/*,application/pdf" @change="uploadMediaFile($event, 'vault')">
                    </label>
                </div>

                <!-- Hosted Media Grid -->
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-white uppercase tracking-wider">Hosted Media Assets on VPS</span>
                        <span class="text-xs text-wa-muted" x-text="uploads.length + ' assets online'"></span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        <template x-for="u in uploads" :key="u.filename">
                            <div class="glass-panel rounded-2xl border border-wa-border overflow-hidden flex flex-col justify-between hover:border-wa-green/40 transition-all shadow-md group">
                                <div class="h-36 bg-black/40 relative overflow-hidden flex items-center justify-center">
                                    <template x-if="u.filename.endsWith('.pdf')">
                                        <div class="text-rose-400 flex flex-col items-center gap-1">
                                            <i class="fas fa-file-pdf text-3xl"></i>
                                            <span class="text-[10px] font-semibold uppercase">PDF Document</span>
                                        </div>
                                    </template>
                                    <template x-if="!u.filename.endsWith('.pdf')">
                                        <img :src="u.url" :alt="u.filename" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                                    </template>
                                    <span class="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[10px] font-mono text-white" x-text="u.size_formatted"></span>
                                </div>

                                <div class="p-4 space-y-2.5">
                                    <div class="space-y-0.5">
                                        <span class="font-bold text-xs text-white block truncate" :title="u.filename" x-text="u.filename"></span>
                                        <span class="text-[10px] text-wa-muted font-mono truncate block" x-text="u.url"></span>
                                    </div>

                                    <div class="pt-2 border-t border-wa-border/60 flex items-center gap-1.5">
                                        <button 
                                            @click="copyDirectLink(u.url)" 
                                            class="flex-1 py-1 bg-wa-surface hover:bg-wa-panel text-white rounded-lg text-[11px] font-semibold border border-wa-border transition-colors flex items-center justify-center gap-1"
                                            title="Copy direct HTTPS URL"
                                        >
                                            <i class="fas fa-copy text-wa-green-bright text-[10px]"></i>
                                            <span>Copy Link</span>
                                        </button>
                                        <button 
                                            @click="useMediaInTemplate(u.url)" 
                                            class="px-2.5 py-1 bg-wa-panel hover:bg-wa-surface text-sky-400 rounded-lg text-[11px] font-semibold border border-wa-border transition-colors"
                                            title="Use in Template"
                                        >
                                            <i class="fas fa-mobile-alt"></i>
                                        </button>
                                        <button 
                                            @click="useMediaInCampaign(u.url)" 
                                            class="px-2.5 py-1 bg-wa-green hover:bg-emerald-600 text-white rounded-lg text-[11px] font-bold transition-all shadow"
                                            title="Use in Campaign"
                                        >
                                            <i class="fas fa-paper-plane"></i>
                                        </button>
                                        <button 
                                            @click="deleteMedia(u.filename)" 
                                            class="px-2 py-1 text-wa-muted hover:text-rose-400 rounded-lg text-[11px] transition-colors"
                                            title="Delete file"
                                        >
                                            <i class="fas fa-trash-alt"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </template>

                        <div x-show="uploads.length === 0" class="col-span-full py-12 text-center text-wa-muted text-xs glass-panel rounded-2xl border border-wa-border">
                            No media uploaded yet. Use the upload button above to upload your first promo banner or file!
                        </div>
                    </div>
                </div>
            </div>

            <!-- TAB 6: DLR REPORTS -->
            <div x-show="activeTab === 'dlr'" class="space-y-6" x-cloak>
                <div class="flex items-center justify-between">
                    <div>
                        <h2 class="text-lg font-bold text-white">Delivery Reports (DLR) Telemetry</h2>
                        <p class="text-xs text-wa-muted">Complete audit log of outbound WhatsApp messages, carrier timestamps, and delivery status.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button 
                            @click="syncUnifonicStatuses()" 
                            class="px-3.5 py-1.5 bg-wa-panel hover:bg-wa-surface text-sky-400 hover:text-white rounded-xl text-xs font-semibold border border-wa-border flex items-center gap-2 transition-colors shadow"
                            :disabled="isSyncingDLR"
                        >
                            <i class="fas fa-sync-alt" :class="{'fa-spin': isSyncingDLR}"></i>
                            <span>Sync Statuses from Unifonic</span>
                        </button>
                        <button 
                            @click="exportDLRToCSV()" 
                            class="px-3.5 py-1.5 bg-wa-panel hover:bg-wa-surface text-white rounded-xl text-xs font-semibold border border-wa-border flex items-center gap-2 transition-colors shadow"
                        >
                            <i class="fas fa-file-csv text-emerald-400"></i>
                            <span>Export CSV</span>
                        </button>
                    </div>
                </div>

                <div class="glass-panel rounded-2xl border border-wa-border overflow-hidden">
                    <div class="p-4 border-b border-wa-border flex items-center justify-between gap-4 bg-wa-panel/50 flex-wrap">
                        <div class="flex items-center gap-2 flex-wrap flex-1 min-w-[240px]">
                            <!-- Traffic Scope Toggle -->
                            <div class="inline-flex p-1 bg-wa-panel rounded-xl border border-wa-border text-xs">
                                <button 
                                    @click="trafficType = 'all'; loadAllData()" 
                                    :class="trafficType === 'all' ? 'bg-wa-green text-white font-semibold shadow' : 'text-wa-muted hover:text-white'"
                                    class="px-2.5 py-1 rounded-lg transition-all"
                                >All Outbound</button>
                                <button 
                                    @click="trafficType = 'campaign'; loadAllData()" 
                                    :class="trafficType === 'campaign' ? 'bg-wa-green text-white font-semibold shadow' : 'text-wa-muted hover:text-white'"
                                    class="px-2.5 py-1 rounded-lg transition-all"
                                >Campaigns</button>
                                <button 
                                    @click="trafficType = 'support'; loadAllData()" 
                                    :class="trafficType === 'support' ? 'bg-wa-green text-white font-semibold shadow' : 'text-wa-muted hover:text-white'"
                                    class="px-2.5 py-1 rounded-lg transition-all"
                                >Support</button>
                            </div>
                            <select x-model="dlrStatusFilter" @change="filterDLR()" class="bg-wa-panel border border-wa-border rounded-xl px-3 py-1.5 text-xs text-wa-text focus:outline-none focus:border-wa-green">
                                <option value="ALL">All Statuses</option>
                                <option value="DELIVERED">Delivered</option>
                                <option value="READ">Read</option>
                                <option value="SENT">Sent</option>
                                <option value="FAILED">Failed</option>
                            </select>
                            <input 
                                type="text" 
                                x-model="dlrPhoneSearch" 
                                @input="filterDLR()" 
                                placeholder="Filter by phone number..." 
                                class="bg-wa-panel border border-wa-border rounded-xl px-3 py-1.5 text-xs text-wa-text focus:outline-none focus:border-wa-green flex-1 min-w-[150px]"
                            >
                        </div>
                        <span class="text-xs text-wa-muted" x-text="filteredReports.length + ' records matching active filter'"></span>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-wa-panel text-wa-muted uppercase text-[10px] tracking-wider border-b border-wa-border">
                                <tr>
                                    <th class="py-3 px-4">Message ID</th>
                                    <th class="py-3 px-4">Recipient Phone</th>
                                    <th class="py-3 px-4">Content Summary</th>
                                    <th class="py-3 px-4">Status</th>
                                    <th class="py-3 px-4">Cost</th>
                                    <th class="py-3 px-4">Sent At</th>
                                    <th class="py-3 px-4">Delivered At</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-wa-border">
                                <template x-for="r in filteredReports.slice(0, 50)" :key="r.message_id">
                                    <tr class="hover:bg-wa-surface/40 transition-colors">
                                        <td class="py-3 px-4 font-mono text-[10px] text-wa-muted" x-text="(r.message_id || '').substring(0, 14) + '...'"></td>
                                        <td class="py-3 px-4 font-mono font-bold text-white" x-text="r.recipient"></td>
                                        <td class="py-3 px-4 max-w-xs truncate text-wa-muted font-arabic" x-text="r.content"></td>
                                        <td class="py-3 px-4">
                                            <span 
                                                class="px-2 py-0.5 rounded text-[10px] font-bold" 
                                                :class="{
                                                    'bg-emerald-500/10 text-emerald-400': r.status === 'DELIVERED',
                                                    'bg-sky-500/10 text-sky-400': r.status === 'READ',
                                                    'bg-blue-500/10 text-blue-400': r.status === 'SENT',
                                                    'bg-rose-500/10 text-rose-400': r.status === 'FAILED'
                                                }"
                                                x-text="r.status"
                                            ></span>
                                        </td>
                                        <td class="py-3 px-4 font-mono text-xs font-bold" :class="r.cost > 0 ? 'text-amber-300' : 'text-wa-muted'" x-text="(r.cost !== undefined ? r.cost.toFixed ? r.cost.toFixed(3) : r.cost : '0.00') + ' ' + (r.currency || stats.currency || 'SAR')"></td>
                                        <td class="py-3 px-4 text-wa-muted text-[11px]" x-text="formatDate(r.sent_at)"></td>
                                        <td class="py-3 px-4 text-wa-muted text-[11px]" x-text="r.delivered_at ? formatDate(r.delivered_at) : '-'"></td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- TAB: SNAPCHAT & META ADS ATTRIBUTION -->
            <div x-show="activeTab === 'ads'" class="space-y-6" x-cloak>
                <!-- Ads Header & Actions -->
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 class="text-lg font-bold text-white flex items-center gap-2">
                            <span>Snapchat &amp; Meta Ads Performance &amp; ROI</span>
                            <span class="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5">
                                <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                                Live Attribution
                            </span>
                        </h2>
                        <p class="text-xs text-wa-muted">Track full-funnel paid ad spend, Click-to-WhatsApp leads, conversation costs, customer conversions, and true blended ROAS.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button 
                            @click="showAdsLinkModal = true" 
                            class="px-3.5 py-2 bg-wa-panel hover:bg-wa-surface text-wa-text border border-wa-border rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow"
                        >
                            <i class="fas fa-link text-cyan-400"></i>
                            <span>Tracking Link Builder</span>
                        </button>
                        <button 
                            @click="showAdsSettingsModal = true" 
                            class="px-3.5 py-2 bg-wa-panel hover:bg-wa-surface text-wa-text border border-wa-border rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow"
                        >
                            <i class="fas fa-sliders-h text-amber-400"></i>
                            <span>Ad Accounts &amp; Keys</span>
                        </button>
                        <button 
                            @click="syncAds()" 
                            class="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold rounded-xl text-xs transition-all shadow-lg flex items-center gap-2 cursor-pointer"
                            :disabled="isSyncingAds"
                        >
                            <i class="fas fa-sync-alt" :class="{'fa-spin': isSyncingAds}"></i>
                            <span x-text="isSyncingAds ? 'Syncing APIs...' : 'Sync Ads Data'"></span>
                        </button>
                    </div>
                </div>

                <!-- Hero KPI Cards (5 Metrics) -->
                <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <!-- Total Spend -->
                    <div class="glass-panel p-4 rounded-2xl border border-wa-border space-y-2">
                        <div class="flex items-center justify-between text-wa-muted text-xs">
                            <span class="font-semibold">Total Ad Spend</span>
                            <i class="fas fa-wallet text-purple-400"></i>
                        </div>
                        <div class="text-xl font-bold font-mono text-white flex items-baseline gap-1">
                            <span x-text="(adsData?.overview?.total_spend_sar || 0).toLocaleString()"></span>
                            <span class="text-xs text-wa-muted font-normal">SAR</span>
                        </div>
                        <div class="text-[10px] text-wa-muted flex items-center gap-1">
                            <span>Meta: <strong class="text-white" x-text="(adsData?.platforms?.meta?.spend_sar || 0).toLocaleString() + ' SAR'"></strong></span>
                            <span>&bull;</span>
                            <span>Snap: <strong class="text-white" x-text="(adsData?.platforms?.snapchat?.spend_sar || 0).toLocaleString() + ' SAR'"></strong></span>
                        </div>
                    </div>

                    <!-- Impressions & Clicks -->
                    <div class="glass-panel p-4 rounded-2xl border border-wa-border space-y-2">
                        <div class="flex items-center justify-between text-wa-muted text-xs">
                            <span class="font-semibold">Clicks &amp; Swipes</span>
                            <i class="fas fa-mouse-pointer text-blue-400"></i>
                        </div>
                        <div class="text-xl font-bold font-mono text-white flex items-baseline gap-1">
                            <span x-text="(adsData?.overview?.total_clicks_swipes || 0).toLocaleString()"></span>
                            <span class="text-xs text-wa-muted font-normal">clicks</span>
                        </div>
                        <div class="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                            <span>Avg CPC: <strong class="font-mono" x-text="(adsData?.overview?.blended_cpc_sar || 0).toFixed(2) + ' SAR'"></strong></span>
                        </div>
                    </div>

                    <!-- WhatsApp Inbound Leads -->
                    <div class="glass-panel p-4 rounded-2xl border border-cyan-500/30 bg-cyan-950/20 space-y-2 relative overflow-hidden">
                        <div class="absolute -right-4 -bottom-4 w-16 h-16 bg-cyan-500/10 rounded-full blur-xl pointer-events-none"></div>
                        <div class="flex items-center justify-between text-cyan-300 text-xs">
                            <span class="font-semibold">WhatsApp Leads</span>
                            <i class="fab fa-whatsapp text-wa-green-bright text-base"></i>
                        </div>
                        <div class="text-xl font-bold font-mono text-white flex items-baseline gap-1">
                            <span x-text="(adsData?.overview?.total_wa_leads || 0).toLocaleString()"></span>
                            <span class="text-xs text-cyan-300 font-normal">chats</span>
                        </div>
                        <div class="text-[10px] text-cyan-200 font-bold flex items-center gap-1">
                            <span>Cost / WA Lead: <strong class="font-mono text-amber-300" x-text="(adsData?.overview?.blended_cost_per_lead_sar || 0).toFixed(2) + ' SAR'"></strong></span>
                        </div>
                    </div>

                    <!-- Conversions -->
                    <div class="glass-panel p-4 rounded-2xl border border-wa-border space-y-2">
                        <div class="flex items-center justify-between text-wa-muted text-xs">
                            <span class="font-semibold">Converted Orders</span>
                            <i class="fas fa-check-double text-emerald-400"></i>
                        </div>
                        <div class="text-xl font-bold font-mono text-emerald-400 flex items-baseline gap-1">
                            <span x-text="(adsData?.overview?.total_conversions || 0).toLocaleString()"></span>
                            <span class="text-xs text-wa-muted font-normal">orders</span>
                        </div>
                        <div class="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                            <span>Conv. Rate: <strong class="font-mono" x-text="(adsData?.overview?.blended_conversion_rate_pct || 0).toFixed(1) + '%'"></strong></span>
                        </div>
                    </div>

                    <!-- Revenue & Blended ROAS -->
                    <div class="glass-panel p-4 rounded-2xl border border-amber-500/30 bg-amber-950/20 space-y-2 relative overflow-hidden">
                        <div class="absolute -right-4 -bottom-4 w-16 h-16 bg-amber-500/10 rounded-full blur-xl pointer-events-none"></div>
                        <div class="flex items-center justify-between text-amber-300 text-xs">
                            <span class="font-semibold">Blended ROAS</span>
                            <i class="fas fa-trophy text-amber-400"></i>
                        </div>
                        <div class="text-2xl font-black font-mono text-amber-300 flex items-baseline gap-1">
                            <span x-text="(adsData?.overview?.blended_roas || 0).toFixed(2)"></span>
                            <span class="text-sm font-bold text-amber-400">x</span>
                        </div>
                        <div class="text-[10px] text-amber-200/80 font-bold flex items-center gap-1">
                            <span>Revenue: <strong class="font-mono text-white" x-text="(adsData?.overview?.total_revenue_sar || 0).toLocaleString() + ' SAR'"></strong></span>
                        </div>
                    </div>
                </div>

                <!-- Platform Head-to-Head Comparison -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <!-- Meta Ads Platform Card -->
                    <div class="glass-panel p-6 rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-950/20 to-wa-panel space-y-5">
                        <div class="flex items-center justify-between border-b border-wa-border pb-3">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center text-lg shadow-inner">
                                    <i class="fab fa-meta"></i>
                                </div>
                                <div>
                                    <h3 class="font-bold text-sm text-white flex items-center gap-2">
                                        <span>Meta Ads (Instagram &amp; Facebook)</span>
                                    </h3>
                                    <p class="text-[11px] text-wa-muted">Click-to-WhatsApp (CTWA) &amp; Direct Lead Ads</p>
                                </div>
                            </div>
                            <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30" x-text="adsData?.platforms?.meta?.active_campaigns ? adsData.platforms.meta.active_campaigns + ' Active Campaigns' : '2 Active Campaigns'"></span>
                        </div>

                        <div class="grid grid-cols-3 gap-3">
                            <div class="p-3 bg-wa-panel/60 rounded-xl border border-wa-border space-y-1">
                                <span class="text-[10px] text-wa-muted block">Ad Spend</span>
                                <div class="text-sm font-bold font-mono text-white" x-text="(adsData?.platforms?.meta?.spend_sar || 0).toLocaleString() + ' SAR'"></div>
                                <span class="text-[9px] text-wa-muted" x-text="(adsData?.platforms?.meta?.impressions || 0).toLocaleString() + ' Impr'"></span>
                            </div>
                            <div class="p-3 bg-wa-panel/60 rounded-xl border border-wa-border space-y-1">
                                <span class="text-[10px] text-wa-muted block">Clicks &amp; CPC</span>
                                <div class="text-sm font-bold font-mono text-white" x-text="(adsData?.platforms?.meta?.clicks || 0).toLocaleString()"></div>
                                <span class="text-[9px] text-blue-400 font-semibold" x-text="'CPC: ' + (adsData?.platforms?.meta?.cpc_sar || 0).toFixed(2) + ' SAR'"></span>
                            </div>
                            <div class="p-3 bg-wa-panel/60 rounded-xl border border-blue-500/30 bg-blue-950/20 space-y-1">
                                <span class="text-[10px] text-blue-300 block">WhatsApp Leads</span>
                                <div class="text-sm font-bold font-mono text-blue-400" x-text="(adsData?.platforms?.meta?.wa_leads || 0).toLocaleString()"></div>
                                <span class="text-[9px] text-amber-300 font-semibold" x-text="'CPL: ' + (adsData?.platforms?.meta?.cost_per_lead_sar || 0).toFixed(2) + ' SAR'"></span>
                            </div>
                        </div>

                        <div class="p-4 bg-wa-panel/80 rounded-xl border border-wa-border flex items-center justify-between">
                            <div>
                                <span class="text-xs text-wa-muted block">Meta Generated Revenue</span>
                                <div class="text-lg font-bold font-mono text-emerald-400" x-text="(adsData?.platforms?.meta?.revenue_sar || 0).toLocaleString() + ' SAR'"></div>
                                <span class="text-[10px] text-wa-muted" x-text="(adsData?.platforms?.meta?.conversions || 0) + ' Paying Customers (' + (adsData?.platforms?.meta?.conversion_rate_pct || 0).toFixed(1) + '%)'"></span>
                            </div>
                            <div class="text-right">
                                <span class="text-xs text-wa-muted block">Meta ROAS</span>
                                <div class="text-2xl font-black font-mono text-amber-400" x-text="(adsData?.platforms?.meta?.roas || 0).toFixed(2) + 'x'"></div>
                                <span class="text-[10px] text-emerald-400 font-bold">High Performing</span>
                            </div>
                        </div>
                    </div>

                    <!-- Snapchat Ads Platform Card -->
                    <div class="glass-panel p-6 rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-yellow-950/20 to-wa-panel space-y-5">
                        <div class="flex items-center justify-between border-b border-wa-border pb-3">
                            <div class="flex items-center gap-3">
                                <div class="w-10 h-10 rounded-xl bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-lg shadow-inner">
                                    <i class="fab fa-snapchat-ghost"></i>
                                </div>
                                <div>
                                    <h3 class="font-bold text-sm text-white flex items-center gap-2">
                                        <span>Snapchat Ads (Story &amp; Spotlight)</span>
                                    </h3>
                                    <p class="text-[11px] text-wa-muted">Swipe-Up to WhatsApp &amp; Geo-Targeted Local Ads</p>
                                </div>
                            </div>
                            <span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/30" x-text="adsData?.platforms?.snapchat?.active_campaigns ? adsData.platforms.snapchat.active_campaigns + ' Active Campaigns' : '2 Active Campaigns'"></span>
                        </div>

                        <div class="grid grid-cols-3 gap-3">
                            <div class="p-3 bg-wa-panel/60 rounded-xl border border-wa-border space-y-1">
                                <span class="text-[10px] text-wa-muted block">Ad Spend</span>
                                <div class="text-sm font-bold font-mono text-white" x-text="(adsData?.platforms?.snapchat?.spend_sar || 0).toLocaleString() + ' SAR'"></div>
                                <span class="text-[9px] text-wa-muted" x-text="(adsData?.platforms?.snapchat?.impressions || 0).toLocaleString() + ' Impr'"></span>
                            </div>
                            <div class="p-3 bg-wa-panel/60 rounded-xl border border-wa-border space-y-1">
                                <span class="text-[10px] text-wa-muted block">Swipe-Ups &amp; CPS</span>
                                <div class="text-sm font-bold font-mono text-white" x-text="(adsData?.platforms?.snapchat?.clicks || 0).toLocaleString()"></div>
                                <span class="text-[9px] text-yellow-400 font-semibold" x-text="'CPS: ' + (adsData?.platforms?.snapchat?.cpc_sar || 0).toFixed(2) + ' SAR'"></span>
                            </div>
                            <div class="p-3 bg-wa-panel/60 rounded-xl border border-yellow-500/30 bg-yellow-950/20 space-y-1">
                                <span class="text-[10px] text-yellow-300 block">WhatsApp Leads</span>
                                <div class="text-sm font-bold font-mono text-yellow-400" x-text="(adsData?.platforms?.snapchat?.wa_leads || 0).toLocaleString()"></div>
                                <span class="text-[9px] text-amber-300 font-semibold" x-text="'CPL: ' + (adsData?.platforms?.snapchat?.cost_per_lead_sar || 0).toFixed(2) + ' SAR'"></span>
                            </div>
                        </div>

                        <div class="p-4 bg-wa-panel/80 rounded-xl border border-wa-border flex items-center justify-between">
                            <div>
                                <span class="text-xs text-wa-muted block">Snap Generated Revenue</span>
                                <div class="text-lg font-bold font-mono text-emerald-400" x-text="(adsData?.platforms?.snapchat?.revenue_sar || 0).toLocaleString() + ' SAR'"></div>
                                <span class="text-[10px] text-wa-muted" x-text="(adsData?.platforms?.snapchat?.conversions || 0) + ' Paying Customers (' + (adsData?.platforms?.snapchat?.conversion_rate_pct || 0).toFixed(1) + '%)'"></span>
                            </div>
                            <div class="text-right">
                                <span class="text-xs text-wa-muted block">Snapchat ROAS</span>
                                <div class="text-2xl font-black font-mono text-amber-400" x-text="(adsData?.platforms?.snapchat?.roas || 0).toFixed(2) + 'x'"></div>
                                <span class="text-[10px] text-emerald-400 font-bold">Strong Volume</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Funnel Visualizer -->
                <div class="glass-panel p-6 rounded-2xl border border-wa-border space-y-4">
                    <div class="flex items-center justify-between">
                        <h3 class="font-bold text-sm text-white flex items-center gap-2">
                            <i class="fas fa-filter text-wa-green-bright"></i>
                            <span>Paid Ads &rarr; WhatsApp &rarr; Sales Conversion Funnel</span>
                        </h3>
                        <span class="text-xs text-wa-muted">Real-time attribution bridge</span>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-5 gap-3 text-center">
                        <div class="p-4 bg-wa-panel rounded-xl border border-wa-border space-y-1">
                            <span class="text-[10px] uppercase font-bold text-wa-muted">1. Ad Impressions</span>
                            <div class="text-lg font-bold text-white font-mono" x-text="(adsData?.overview?.total_impressions || 0).toLocaleString()"></div>
                            <span class="text-[10px] text-wa-muted">100% Reach</span>
                        </div>
                        <div class="p-4 bg-wa-panel rounded-xl border border-wa-border space-y-1">
                            <span class="text-[10px] uppercase font-bold text-blue-400">2. Clicks &amp; Swipes</span>
                            <div class="text-lg font-bold text-blue-400 font-mono" x-text="(adsData?.overview?.total_clicks_swipes || 0).toLocaleString()"></div>
                            <span class="text-[10px] text-blue-300 font-semibold" x-text="(((adsData?.overview?.total_clicks_swipes || 0) / (adsData?.overview?.total_impressions || 1)) * 100).toFixed(2) + '% CTR'"></span>
                        </div>
                        <div class="p-4 bg-wa-panel rounded-xl border border-cyan-500/40 bg-cyan-950/20 space-y-1">
                            <span class="text-[10px] uppercase font-bold text-cyan-300">3. WhatsApp Chats</span>
                            <div class="text-lg font-bold text-cyan-300 font-mono" x-text="(adsData?.overview?.total_wa_leads || 0).toLocaleString()"></div>
                            <span class="text-[10px] text-cyan-200 font-semibold" x-text="(((adsData?.overview?.total_wa_leads || 0) / (adsData?.overview?.total_clicks_swipes || 1)) * 100).toFixed(1) + '% Start Rate'"></span>
                        </div>
                        <div class="p-4 bg-wa-panel rounded-xl border border-wa-border space-y-1">
                            <span class="text-[10px] uppercase font-bold text-emerald-400">4. Paid Conversions</span>
                            <div class="text-lg font-bold text-emerald-400 font-mono" x-text="(adsData?.overview?.total_conversions || 0).toLocaleString()"></div>
                            <span class="text-[10px] text-emerald-400 font-semibold" x-text="(adsData?.overview?.blended_conversion_rate_pct || 0).toFixed(1) + '% Conv Rate'"></span>
                        </div>
                        <div class="p-4 bg-wa-panel rounded-xl border border-amber-500/40 bg-amber-950/20 space-y-1">
                            <span class="text-[10px] uppercase font-bold text-amber-300">5. Revenue &amp; ROAS</span>
                            <div class="text-lg font-bold text-amber-300 font-mono" x-text="(adsData?.overview?.total_revenue_sar || 0).toLocaleString() + ' SAR'"></div>
                            <span class="text-[10px] text-amber-400 font-bold" x-text="(adsData?.overview?.blended_roas || 0).toFixed(2) + 'x Return'"></span>
                        </div>
                    </div>
                </div>

                <!-- Campaign Breakdown Table -->
                <div class="glass-panel rounded-2xl border border-wa-border overflow-hidden">
                    <div class="p-4 border-b border-wa-border flex flex-wrap items-center justify-between gap-4">
                        <div class="flex items-center gap-2">
                            <h3 class="font-bold text-sm text-white">Campaign Performance Table</h3>
                            <span class="text-xs bg-wa-surface text-wa-muted px-2 py-0.5 rounded-md font-mono" x-text="filteredAdsCampaigns().length + ' campaigns'"></span>
                        </div>

                        <div class="flex items-center gap-3">
                            <!-- Platform filter -->
                            <div class="flex items-center bg-wa-panel rounded-xl p-1 border border-wa-border text-xs">
                                <button 
                                    @click="adsPlatformFilter = 'ALL'" 
                                    :class="adsPlatformFilter === 'ALL' ? 'bg-wa-surface text-white font-bold' : 'text-wa-muted hover:text-white'" 
                                    class="px-2.5 py-1 rounded-lg transition-all"
                                >
                                    All
                                </button>
                                <button 
                                    @click="adsPlatformFilter = 'meta'" 
                                    :class="adsPlatformFilter === 'meta' ? 'bg-blue-600 text-white font-bold' : 'text-wa-muted hover:text-white'" 
                                    class="px-2.5 py-1 rounded-lg transition-all flex items-center gap-1"
                                >
                                    <i class="fab fa-meta text-[10px]"></i> Meta
                                </button>
                                <button 
                                    @click="adsPlatformFilter = 'snapchat'" 
                                    :class="adsPlatformFilter === 'snapchat' ? 'bg-yellow-500 text-black font-bold' : 'text-wa-muted hover:text-white'" 
                                    class="px-2.5 py-1 rounded-lg transition-all flex items-center gap-1"
                                >
                                    <i class="fab fa-snapchat-ghost text-[10px]"></i> Snap
                                </button>
                            </div>

                            <!-- Search -->
                            <input 
                                type="text" 
                                x-model="adsSearch" 
                                placeholder="Search campaign or keyword..." 
                                class="bg-wa-panel border border-wa-border rounded-xl px-3 py-1.5 text-xs text-wa-text focus:outline-none focus:border-cyan-400 w-52"
                            >
                        </div>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-wa-panel/80 text-wa-muted border-b border-wa-border text-[11px] uppercase tracking-wider">
                                <tr>
                                    <th class="py-3 px-4">Platform</th>
                                    <th class="py-3 px-4">Campaign Name</th>
                                    <th class="py-3 px-4">Delivery</th>
                                    <th class="py-3 px-4">Review</th>
                                    <th class="py-3 px-4 text-right">Impressions</th>
                                    <th class="py-3 px-4 text-right">Spend (SAR)</th>
                                    <th class="py-3 px-4 text-right">Clicks/Swipes</th>
                                    <th class="py-3 px-4 text-right">WA Leads</th>
                                    <th class="py-3 px-4 text-right">Cost / Lead</th>
                                    <th class="py-3 px-4 text-right">Orders</th>
                                    <th class="py-3 px-4 text-right">Revenue</th>
                                    <th class="py-3 px-4 text-right">ROAS</th>
                                    <th class="py-3 px-4">Attribution Tag</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-wa-border">
                                <template x-for="c in filteredAdsCampaigns()" :key="c.id">
                                    <tr class="hover:bg-wa-surface/30 transition-colors">
                                        <td class="py-3 px-4">
                                            <span 
                                                class="px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 w-fit" 
                                                :class="c.platform === 'meta' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20'"
                                            >
                                                <i :class="c.platform === 'meta' ? 'fab fa-meta' : 'fab fa-snapchat-ghost'"></i>
                                                <span x-text="c.platform === 'meta' ? 'Meta' : 'Snap'"></span>
                                            </span>
                                        </td>
                                        <td class="py-3 px-4">
                                            <div class="font-semibold text-white max-w-xs truncate" x-text="c.campaign_name"></div>
                                            <div class="text-[10px] text-wa-muted flex items-center gap-2 mt-0.5" x-show="c.ads_list && c.ads_list.length > 0">
                                                <span x-text="c.ads_list.length + ' creative(s)'"></span>
                                                <template x-for="ad in (c.ads_list || []).slice(0, 2)" :key="ad.id">
                                                    <span class="text-[9px] px-1.5 py-0.2 rounded bg-wa-surface border border-wa-border text-wa-muted truncate max-w-[100px]" x-text="ad.name"></span>
                                                </template>
                                            </div>
                                        </td>
                                        <td class="py-3 px-4">
                                            <template x-if="c.delivery_status === 'DELIVERING'">
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 w-fit">
                                                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                                    <span>Delivering</span>
                                                </span>
                                            </template>
                                            <template x-if="c.delivery_status === 'COMPLETED'">
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/15 text-slate-300 border border-slate-500/30 flex items-center gap-1 w-fit">
                                                    <i class="fas fa-flag-checkered text-[9px]"></i>
                                                    <span>Completed</span>
                                                </span>
                                            </template>
                                            <template x-if="c.delivery_status === 'PAUSED'">
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/15 text-gray-400 border border-gray-500/30 flex items-center gap-1 w-fit">
                                                    <i class="fas fa-pause text-[8px]"></i>
                                                    <span>Paused</span>
                                                </span>
                                            </template>
                                            <template x-if="c.delivery_status === 'REJECTED'">
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/15 text-red-400 border border-red-500/30 flex items-center gap-1 w-fit">
                                                    <i class="fas fa-times-circle text-[9px]"></i>
                                                    <span>Rejected</span>
                                                </span>
                                            </template>
                                            <template x-if="c.delivery_status === 'PENDING_REVIEW'">
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 w-fit">
                                                    <i class="fas fa-clock text-[9px]"></i>
                                                    <span>In Review</span>
                                                </span>
                                            </template>
                                            <template x-if="!['DELIVERING', 'COMPLETED', 'PAUSED', 'REJECTED', 'PENDING_REVIEW'].includes(c.delivery_status)">
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/15 text-gray-400 border border-gray-500/30" x-text="c.status || 'PAUSED'"></span>
                                            </template>
                                        </td>
                                        <td class="py-3 px-4">
                                            <span 
                                                class="px-2 py-0.5 rounded text-[9px] font-bold"
                                                :class="c.review_status === 'REJECTED' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : (c.review_status === 'PENDING_REVIEW' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20')"
                                                x-text="c.review_status || 'APPROVED'"
                                            ></span>
                                        </td>
                                        <td class="py-3 px-4 text-right font-mono text-purple-300 font-bold" x-text="(c.impressions || 0).toLocaleString()"></td>
                                        <td class="py-3 px-4 text-right font-mono font-bold text-white" x-text="(c.spend_sar || 0).toLocaleString()"></td>
                                        <td class="py-3 px-4 text-right font-mono text-wa-muted" x-text="(c.clicks || 0).toLocaleString()"></td>
                                        <td class="py-3 px-4 text-right font-mono font-bold text-cyan-400" x-text="(c.wa_conversations_started || 0).toLocaleString()"></td>
                                        <td class="py-3 px-4 text-right font-mono font-bold text-amber-300" x-text="(c.cost_per_wa_lead_sar || 0).toFixed(2) + ' SAR'"></td>
                                        <td class="py-3 px-4 text-right font-mono text-emerald-400 font-bold" x-text="(c.conversions_count || 0)"></td>
                                        <td class="py-3 px-4 text-right font-mono font-bold text-white" x-text="(c.revenue_sar || 0).toLocaleString() + ' SAR'"></td>
                                        <td class="py-3 px-4 text-right font-mono font-black text-amber-400" x-text="(c.roas || 0).toFixed(2) + 'x'"></td>
                                        <td class="py-3 px-4">
                                            <span class="px-2 py-0.5 rounded bg-wa-panel border border-wa-border text-[10px] font-mono text-wa-muted" x-text="c.ad_keyword || '-'"></span>
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- MODAL: ADS TRACKING LINK BUILDER -->
            <div x-show="showAdsLinkModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak>
                <div class="glass-panel w-full max-w-lg rounded-2xl border border-wa-border p-6 space-y-5 relative shadow-2xl">
                    <div class="flex items-center justify-between border-b border-wa-border pb-3">
                        <h3 class="font-bold text-base text-white flex items-center gap-2">
                            <i class="fas fa-link text-cyan-400"></i>
                            <span>Click-to-WhatsApp Ad Link Builder</span>
                        </h3>
                        <button @click="showAdsLinkModal = false" class="text-wa-muted hover:text-white p-1">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="space-y-4">
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted">Ad Platform</label>
                            <select 
                                x-model="adsLinkGen.platform" 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                            >
                                <option value="snapchat">Snapchat Ads (Swipe-Up Link)</option>
                                <option value="meta">Meta Ads (Instagram / Facebook Story / Reel)</option>
                            </select>
                        </div>

                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted">Campaign Tracking Keyword</label>
                            <input 
                                type="text" 
                                x-model="adsLinkGen.keyword" 
                                placeholder="e.g. SNAP96, META_OCTOBER, VIP_WASH" 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono uppercase focus:outline-none focus:border-cyan-400"
                            >
                            <span class="text-[10px] text-wa-muted">This keyword will be prefixed in the customer's message to auto-attribute the lead.</span>
                        </div>

                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted">Pre-filled Customer Message</label>
                            <textarea 
                                x-model="adsLinkGen.custom_text" 
                                rows="2" 
                                placeholder="e.g. مرحباً RushWash، أود الاستفسار عن عرض اليوم الوطني 🚗" 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-arabic focus:outline-none focus:border-cyan-400"
                            ></textarea>
                        </div>

                        <button 
                            @click="generateTrackingLink()" 
                            class="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow"
                        >
                            <i class="fas fa-magic"></i> Generate Tracking Link
                        </button>

                        <div x-show="adsLinkGen.result_url" class="p-3 bg-wa-panel rounded-xl border border-cyan-500/30 space-y-2">
                            <label class="text-[11px] font-bold text-cyan-300 block">Generated wa.me Tracking URL:</label>
                            <div class="flex items-center gap-2">
                                <input 
                                    type="text" 
                                    readonly 
                                    :value="adsLinkGen.result_url" 
                                    class="w-full bg-wa-deep border border-wa-border rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                                >
                                <button 
                                    @click="copyTrackingLink()" 
                                    class="px-3 py-1.5 bg-wa-green hover:bg-emerald-600 text-white rounded-lg text-xs font-bold shrink-0 transition-all flex items-center gap-1 cursor-pointer"
                                >
                                    <i class="fas fa-copy"></i> Copy
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- MODAL: ADS API CREDENTIALS & SETTINGS -->
            <div x-show="showAdsSettingsModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak>
                <div class="glass-panel w-full max-w-xl rounded-2xl border border-wa-border p-6 space-y-5 relative shadow-2xl max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between border-b border-wa-border pb-3">
                        <h3 class="font-bold text-base text-white flex items-center gap-2">
                            <i class="fas fa-sliders-h text-amber-400"></i>
                            <span>Meta &amp; Snapchat Ads API Configuration</span>
                        </h3>
                        <button @click="showAdsSettingsModal = false" class="text-wa-muted hover:text-white p-1">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="space-y-5">
                        <!-- Meta API Config -->
                        <div class="p-4 bg-wa-panel/60 rounded-xl border border-blue-500/30 space-y-3">
                            <h4 class="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                                <i class="fab fa-meta"></i> Meta Marketing API (Graph API)
                            </h4>
                            <div class="space-y-1">
                                <label class="text-[11px] text-wa-muted font-semibold">Meta Ad Account ID</label>
                                <input 
                                    type="text" 
                                    x-model="adsSettingsForm.meta.ad_account_id" 
                                    placeholder="act_1234567890" 
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-400"
                                >
                            </div>
                            <div class="space-y-1">
                                <label class="text-[11px] text-wa-muted font-semibold">Meta System User / Long-Lived Access Token</label>
                                <input 
                                    type="password" 
                                    x-model="adsSettingsForm.meta.access_token" 
                                    placeholder="EAAB..." 
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-400"
                                >
                            </div>
                        </div>

                        <!-- Snapchat API Config -->
                        <div class="p-4 bg-wa-panel/60 rounded-xl border border-yellow-500/30 space-y-3">
                            <h4 class="text-xs font-bold text-yellow-300 flex items-center gap-1.5">
                                <i class="fab fa-snapchat-ghost"></i> Snapchat Marketing API
                            </h4>
                            <div class="space-y-1">
                                <label class="text-[11px] text-wa-muted font-semibold">Snap Ad Account ID</label>
                                <input 
                                    type="text" 
                                    x-model="adsSettingsForm.snapchat.ad_account_id" 
                                    placeholder="snap_acc_..." 
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-400"
                                >
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div class="space-y-1">
                                    <label class="text-[11px] text-wa-muted font-semibold">Snap Client ID</label>
                                    <input 
                                        type="text" 
                                        x-model="adsSettingsForm.snapchat.client_id" 
                                        placeholder="client_id..." 
                                        class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-400"
                                    >
                                </div>
                                <div class="space-y-1">
                                    <label class="text-[11px] text-wa-muted font-semibold">Snap Client Secret</label>
                                    <input 
                                        type="password" 
                                        x-model="adsSettingsForm.snapchat.client_secret" 
                                        placeholder="••••••••" 
                                        class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-400"
                                    >
                                </div>
                            </div>
                            <div class="space-y-1">
                                <label class="text-[11px] text-wa-muted font-semibold">Snap Refresh Token</label>
                                <input 
                                    type="password" 
                                    x-model="adsSettingsForm.snapchat.refresh_token" 
                                    placeholder="refresh_token..." 
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-400"
                                >
                            </div>

                            <!-- Snap 1-Click OAuth Helper -->
                            <div class="p-3 bg-yellow-950/20 border border-yellow-500/30 rounded-xl space-y-2">
                                <div class="flex items-center justify-between">
                                    <span class="text-[11px] font-bold text-yellow-300">1-Click Snapchat Connect:</span>
                                    <a 
                                        :href="'https://accounts.snapchat.com/login/oauth2/authorize?client_id=' + (adsSettingsForm.snapchat.client_id || '4971139a-3473-4f0c-b1cc-c4dc3c1b5a18') + '&redirect_uri=https://whatsapp.rush.com.sa/&response_type=code&scope=snapchat-marketing-api'" 
                                        target="_blank" 
                                        class="px-3 py-1 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg text-xs flex items-center gap-1 transition-all shadow"
                                    >
                                        <i class="fab fa-snapchat-ghost"></i> 1. Authorize on Snap
                                    </a>
                                </div>
                                <div class="flex items-center gap-2">
                                    <input 
                                        type="text" 
                                        x-model="snapAuthCodeInput" 
                                        placeholder="Paste 'code=' from redirected URL here..." 
                                        class="w-full bg-wa-panel border border-wa-border rounded-lg px-2.5 py-1.5 text-[11px] text-white font-mono"
                                    >
                                    <button 
                                        type="button"
                                        @click="exchangeSnapOAuthCode()" 
                                        class="px-3 py-1.5 bg-wa-green hover:bg-emerald-600 text-white font-bold rounded-lg text-xs shrink-0 cursor-pointer"
                                    >
                                        Connect
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- WhatsApp Destination Number -->
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted">Destination WhatsApp Business Number</label>
                            <input 
                                type="text" 
                                x-model="adsSettingsForm.whatsapp_business_phone" 
                                placeholder="966559421442" 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-wa-green"
                            >
                        </div>

                        <div class="pt-3 border-t border-wa-border flex items-center justify-end gap-3">
                            <button 
                                @click="showAdsSettingsModal = false" 
                                class="px-4 py-2 bg-wa-surface hover:bg-wa-panel text-wa-text rounded-xl text-xs font-semibold"
                            >
                                Cancel
                            </button>
                            <button 
                                @click="saveAdsSettings()" 
                                class="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black font-bold rounded-xl text-xs shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                                :disabled="isSavingAdsSettings"
                            >
                                <i class="fas fa-save" :class="{'fa-spin': isSavingAdsSettings}"></i>
                                <span x-text="isSavingAdsSettings ? 'Saving...' : 'Save API Credentials'"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- TAB: SMART TRACKING LINKS (RUSH.COM.SA) -->
            <div x-show="activeTab === 'links'" class="space-y-6" x-cloak>
                <!-- Header Banner -->
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 class="text-lg font-bold text-white flex items-center gap-2">
                            <span>Smart Tracking Links (rush.com.sa)</span>
                            <span class="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-0.5 rounded-full font-bold">Traffic &amp; Click Analytics</span>
                        </h2>
                        <p class="text-xs text-wa-muted">Create branded short links that redirect to rush.com.sa, automatically attach UTM campaign tags, count clicks, identify unique visitors, and track device/OS statistics in real time.</p>
                    </div>

                    <div class="flex items-center gap-3">
                        <button 
                            @click="loadTrackingLinks()" 
                            class="px-3 py-2 bg-wa-surface hover:bg-wa-panel border border-wa-border text-wa-text rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <i class="fas fa-sync-alt text-xs"></i>
                            <span>Refresh</span>
                        </button>
                        <button 
                            @click="openCreateLinkModal()" 
                            class="px-4 py-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold rounded-xl text-xs transition-all shadow-lg flex items-center gap-2 cursor-pointer"
                        >
                            <i class="fas fa-plus"></i>
                            <span>Create Tracking Link</span>
                        </button>
                    </div>
                </div>

                <!-- KPI Metric Cards -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div class="glass-panel p-5 rounded-2xl border border-wa-border space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-wa-muted">Total Short Links</span>
                            <div class="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                                <i class="fas fa-link text-xs"></i>
                            </div>
                        </div>
                        <div class="text-2xl font-bold font-mono text-white" x-text="trackingLinksData?.total_links || 0"></div>
                        <span class="text-[10px] text-wa-muted">Active Branded Trackers</span>
                    </div>

                    <div class="glass-panel p-5 rounded-2xl border border-wa-border space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-wa-muted">Total Clicks &amp; Swipes</span>
                            <div class="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                                <i class="fas fa-mouse-pointer text-xs"></i>
                            </div>
                        </div>
                        <div class="text-2xl font-bold font-mono text-cyan-300" x-text="(trackingLinksData?.total_clicks || 0).toLocaleString()"></div>
                        <span class="text-[10px] text-cyan-400 font-semibold" x-text="(trackingLinksData?.total_unique_clicks || 0).toLocaleString() + ' unique visitors'"></span>
                    </div>

                    <div class="glass-panel p-5 rounded-2xl border border-wa-border space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-semibold text-wa-muted">Routing Engine</span>
                            <div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                                <i class="fas fa-bolt text-xs"></i>
                            </div>
                        </div>
                        <div class="text-2xl font-bold font-mono text-emerald-400">302 Direct</div>
                        <span class="text-[10px] text-emerald-400 font-semibold">Zero-Latency Redirect &amp; UTM Injection</span>
                    </div>
                </div>

                <!-- Links Table -->
                <div class="glass-panel rounded-2xl border border-wa-border overflow-hidden">
                    <div class="p-4 border-b border-wa-border flex flex-wrap items-center justify-between gap-4">
                        <div class="flex items-center gap-2">
                            <h3 class="font-bold text-sm text-white">Branded Smart Tracking Links</h3>
                            <span class="text-xs bg-wa-surface text-wa-muted px-2 py-0.5 rounded-md font-mono" x-text="(trackingLinksData?.links?.length || 0) + ' links'"></span>
                        </div>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-wa-panel/80 text-wa-muted border-b border-wa-border text-[11px] uppercase tracking-wider">
                                <tr>
                                    <th class="py-3 px-4">Status</th>
                                    <th class="py-3 px-4">Campaign Title &amp; Platform</th>
                                    <th class="py-3 px-4">Smart Tracking Short Link</th>
                                    <th class="py-3 px-4">Destination Target (rush.com.sa)</th>
                                    <th class="py-3 px-4 text-right">Clicks</th>
                                    <th class="py-3 px-4 text-right">Unique</th>
                                    <th class="py-3 px-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-wa-border">
                                <template x-for="link in trackingLinksData?.links || []" :key="link.slug">
                                    <tr class="hover:bg-wa-surface/30 transition-colors">
                                        <!-- Status & Toggle -->
                                        <td class="py-3 px-4">
                                            <button 
                                                @click="toggleLinkStatus(link.slug)" 
                                                class="px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                                                :class="link.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25' : 'bg-gray-500/15 text-gray-400 border border-gray-500/30 hover:bg-gray-500/25'"
                                                :title="'Click to toggle status (Currently ' + link.status + ')'"
                                            >
                                                <span class="w-1.5 h-1.5 rounded-full" :class="link.status === 'ACTIVE' ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'"></span>
                                                <span x-text="link.status"></span>
                                            </button>
                                        </td>

                                        <!-- Title & Platform -->
                                        <td class="py-3 px-4 max-w-xs">
                                            <div class="font-bold text-white truncate text-xs" x-text="link.title"></div>
                                            <div class="flex items-center gap-2 mt-0.5">
                                                <span 
                                                    class="px-1.5 py-0.5 rounded text-[9px] font-bold capitalize flex items-center gap-1 w-fit" 
                                                    :class="{
                                                        'bg-yellow-500/10 text-yellow-300 border border-yellow-500/20': link.platform === 'snapchat',
                                                        'bg-pink-500/10 text-pink-400 border border-pink-500/20': link.platform === 'instagram',
                                                        'bg-blue-500/10 text-blue-400 border border-blue-500/20': link.platform === 'meta',
                                                        'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20': link.platform === 'tiktok',
                                                        'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20': link.platform === 'whatsapp',
                                                        'bg-gray-500/10 text-gray-300 border border-gray-500/20': link.platform === 'direct'
                                                    }"
                                                >
                                                    <i :class="{
                                                        'fab fa-snapchat-ghost': link.platform === 'snapchat',
                                                        'fab fa-instagram': link.platform === 'instagram',
                                                        'fab fa-meta': link.platform === 'meta',
                                                        'fab fa-tiktok': link.platform === 'tiktok',
                                                        'fab fa-whatsapp': link.platform === 'whatsapp',
                                                        'fas fa-globe': link.platform === 'direct'
                                                    }"></i>
                                                    <span x-text="link.platform"></span>
                                                </span>
                                            </div>
                                        </td>

                                        <!-- Short Link -->
                                        <td class="py-3 px-4">
                                            <div class="flex items-center gap-1.5">
                                                <span class="font-mono font-bold text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20 text-[11px]" x-text="'/r/' + link.slug"></span>
                                                <button 
                                                    @click="copyTextToClipboard('https://whatsapp.rush.com.sa/r/' + link.slug, 'Smart Tracking URL copied to clipboard!')" 
                                                    class="p-1 hover:text-white text-wa-muted transition-colors cursor-pointer"
                                                    title="Copy Short Link"
                                                >
                                                    <i class="fas fa-copy text-xs"></i>
                                                </button>
                                                <a 
                                                    :href="'https://whatsapp.rush.com.sa/r/' + link.slug" 
                                                    target="_blank" 
                                                    class="p-1 hover:text-white text-wa-muted transition-colors cursor-pointer"
                                                    title="Test Redirect in New Tab"
                                                >
                                                    <i class="fas fa-external-link-alt text-xs"></i>
                                                </a>
                                            </div>
                                        </td>

                                        <!-- Destination URL -->
                                        <td class="py-3 px-4 max-w-sm">
                                            <div class="text-[11px] text-wa-muted font-mono truncate" :title="link.destination_url" x-text="link.destination_url"></div>
                                        </td>

                                        <!-- Clicks -->
                                        <td class="py-3 px-4 text-right">
                                            <span class="font-mono font-bold text-cyan-300 text-xs" x-text="(link.total_clicks || 0).toLocaleString()"></span>
                                        </td>

                                        <!-- Unique -->
                                        <td class="py-3 px-4 text-right">
                                            <span class="font-mono font-bold text-emerald-400 text-xs" x-text="(link.unique_clicks || 0).toLocaleString()"></span>
                                        </td>

                                        <!-- Actions -->
                                        <td class="py-3 px-4 text-right">
                                            <div class="flex items-center justify-end gap-1.5">
                                                <button 
                                                    @click="copyTextToClipboard('https://whatsapp.rush.com.sa/r/' + link.slug, 'Tracking Link copied!')" 
                                                    class="px-2.5 py-1 bg-cyan-600/20 hover:bg-cyan-600 text-cyan-300 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                    title="Copy Tracking URL"
                                                >
                                                    <i class="fas fa-copy"></i>
                                                    <span>Copy</span>
                                                </button>
                                                <button 
                                                    @click="openEditLinkModal(link)" 
                                                    class="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                    title="Edit Smart Tracking Link"
                                                >
                                                    <i class="fas fa-edit"></i>
                                                    <span>Edit</span>
                                                </button>
                                                <button 
                                                    @click="openLinkStatsModal(link.slug)" 
                                                    class="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                                                    title="View Detailed Analytics"
                                                >
                                                    <i class="fas fa-chart-bar"></i>
                                                    <span>Stats</span>
                                                </button>
                                                <button 
                                                    @click="openQrModal('https://whatsapp.rush.com.sa/r/' + link.slug, link.title)" 
                                                    class="p-1.5 bg-wa-surface hover:bg-wa-panel text-wa-muted hover:text-white rounded-lg text-xs transition-colors cursor-pointer"
                                                    title="Generate QR Code"
                                                >
                                                    <i class="fas fa-qrcode"></i>
                                                </button>
                                                <button 
                                                    @click="deleteTrackingLink(link.slug)" 
                                                    class="p-1.5 hover:bg-rose-500/20 text-wa-muted hover:text-rose-400 rounded-lg text-xs transition-colors cursor-pointer"
                                                    title="Delete Link"
                                                >
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- MODAL: CREATE TRACKING LINK -->
            <div x-show="showCreateLinkModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak>
                <div class="glass-panel w-full max-w-xl rounded-2xl border border-wa-border p-6 space-y-5 relative shadow-2xl max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between border-b border-wa-border pb-3">
                        <h3 class="font-bold text-base text-white flex items-center gap-2">
                            <i class="fas fa-link text-indigo-400"></i>
                            <span x-text="editingLinkSlug ? 'Edit Smart Tracking Link' : 'Create Smart Tracking Link (rush.com.sa)'"></span>
                        </h3>
                        <button @click="showCreateLinkModal = false" class="text-wa-muted hover:text-white p-1 cursor-pointer">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="space-y-4">
                        <!-- Campaign Title -->
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-white">Campaign Title / Name</label>
                            <input 
                                type="text" 
                                x-model="newLinkForm.title" 
                                @input="autoFillUtmFromPlatform()"
                                placeholder="e.g. National Day Special Offer 2026" 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400"
                            >
                        </div>

                        <!-- Status and Platform row -->
                        <div class="grid grid-cols-2 gap-3">
                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-white">Status</label>
                                <select 
                                    x-model="newLinkForm.status" 
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400"
                                >
                                    <option value="ACTIVE">🟢 ACTIVE (Tracking Enabled)</option>
                                    <option value="PAUSED">⏸️ PAUSED (Paused)</option>
                                </select>
                            </div>

                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-white">Platform / Channel</label>
                                <select 
                                    x-model="newLinkForm.platform" 
                                    @change="autoFillUtmFromPlatform()"
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-400"
                                >
                                    <option value="snapchat">👻 Snapchat Ads (Swipe-Up)</option>
                                    <option value="instagram">📸 Instagram Bio / Reel / Story</option>
                                    <option value="meta">🌐 Meta Ads (Facebook / Instagram Feed)</option>
                                    <option value="tiktok">🎵 TikTok Ads &amp; Bio</option>
                                    <option value="whatsapp">💬 WhatsApp Broadcast</option>
                                    <option value="sms">📱 SMS Campaign Link</option>
                                    <option value="google">🔍 Google Ads (Search / Display)</option>
                                    <option value="influencer">🤝 Influencer / Affiliate</option>
                                    <option value="direct">🔗 Direct Website / Flyer</option>
                                </select>
                            </div>
                        </div>

                        <!-- Custom Slug -->
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-white">Custom URL Slug</label>
                            <div class="flex items-center">
                                <span class="bg-wa-deep border border-r-0 border-wa-border px-3 py-2 text-xs text-wa-muted rounded-l-xl font-mono">https://whatsapp.rush.com.sa/r/</span>
                                <input 
                                    type="text" 
                                    x-model="newLinkForm.slug" 
                                    placeholder="watan96" 
                                    class="w-full bg-wa-panel border border-wa-border rounded-r-xl px-3 py-2 text-xs text-indigo-300 font-mono focus:outline-none focus:border-indigo-400"
                                >
                            </div>
                        </div>

                        <!-- Destination URL -->
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-white">Destination Target URL</label>
                            <input 
                                type="text" 
                                x-model="newLinkForm.destination_url" 
                                placeholder="https://rush.com.sa/en" 
                                class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-400"
                            >
                            <span class="text-[10px] text-wa-muted">Where visitors will be redirected (e.g. rush.com.sa homepage or package page).</span>
                        </div>

                        <!-- UTM Parameters Accordion -->
                        <div class="p-4 bg-wa-panel/80 rounded-xl border border-wa-border space-y-3">
                            <h4 class="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                                <i class="fas fa-tags"></i>
                                <span>Auto-Generated UTM Campaign Tags</span>
                            </h4>
                            <div class="grid grid-cols-2 gap-3">
                                <div class="space-y-1">
                                    <label class="text-[11px] text-wa-muted">utm_source</label>
                                    <input type="text" x-model="newLinkForm.utm_source" class="w-full bg-wa-deep border border-wa-border rounded-lg px-2.5 py-1.5 text-xs text-white font-mono">
                                </div>
                                <div class="space-y-1">
                                    <label class="text-[11px] text-wa-muted">utm_medium</label>
                                    <input type="text" x-model="newLinkForm.utm_medium" class="w-full bg-wa-deep border border-wa-border rounded-lg px-2.5 py-1.5 text-xs text-white font-mono">
                                </div>
                                <div class="space-y-1">
                                    <label class="text-[11px] text-wa-muted">utm_campaign</label>
                                    <input type="text" x-model="newLinkForm.utm_campaign" class="w-full bg-wa-deep border border-wa-border rounded-lg px-2.5 py-1.5 text-xs text-white font-mono">
                                </div>
                                <div class="space-y-1">
                                    <label class="text-[11px] text-wa-muted">utm_content (optional)</label>
                                    <input type="text" x-model="newLinkForm.utm_content" placeholder="e.g. video_ad_1, discount_50" class="w-full bg-wa-deep border border-wa-border rounded-lg px-2.5 py-1.5 text-xs text-white font-mono">
                                </div>
                            </div>
                        </div>

                        <div class="pt-3 border-t border-wa-border flex items-center justify-end gap-3">
                            <button 
                                @click="showCreateLinkModal = false" 
                                class="px-4 py-2 bg-wa-surface hover:bg-wa-panel text-wa-text rounded-xl text-xs font-semibold cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button 
                                @click="submitTrackingLink()" 
                                class="px-5 py-2 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold rounded-xl text-xs shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                                :disabled="isCreatingLink"
                            >
                                <i class="fas" :class="isCreatingLink ? 'fa-spinner fa-spin' : (editingLinkSlug ? 'fa-check' : 'fa-link')"></i>
                                <span x-text="isCreatingLink ? (editingLinkSlug ? 'Saving...' : 'Creating...') : (editingLinkSlug ? 'Save Changes' : 'Generate Short Link')"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- MODAL: LINK DETAILED ANALYTICS -->
            <div x-show="showLinkStatsModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak>
                <div class="glass-panel w-full max-w-2xl rounded-2xl border border-wa-border p-6 space-y-5 relative shadow-2xl max-h-[90vh] overflow-y-auto">
                    <div class="flex items-center justify-between border-b border-wa-border pb-3">
                        <div>
                            <h3 class="font-bold text-base text-white flex items-center gap-2">
                                <i class="fas fa-chart-pie text-indigo-400"></i>
                                <span x-text="'Analytics: ' + (activeLinkStats?.link?.title || 'Link Stats')"></span>
                            </h3>
                            <span class="text-xs font-mono text-indigo-300" x-text="'/r/' + (activeLinkStats?.link?.slug || '')"></span>
                        </div>
                        <button @click="showLinkStatsModal = false" class="text-wa-muted hover:text-white p-1 cursor-pointer">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div x-show="!activeLinkStats" class="py-12 text-center text-wa-muted">
                        <i class="fas fa-spinner fa-spin text-2xl mb-2 text-indigo-400"></i>
                        <p class="text-xs">Loading analytics data...</p>
                    </div>

                    <div x-show="activeLinkStats" class="space-y-5">
                        <!-- Stat Highlights -->
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div class="p-3 bg-wa-panel rounded-xl border border-wa-border text-center">
                                <span class="text-[10px] text-wa-muted block uppercase">Total Clicks</span>
                                <span class="text-xl font-bold font-mono text-cyan-300" x-text="activeLinkStats?.total_clicks || 0"></span>
                            </div>
                            <div class="p-3 bg-wa-panel rounded-xl border border-wa-border text-center">
                                <span class="text-[10px] text-wa-muted block uppercase">Unique Users</span>
                                <span class="text-xl font-bold font-mono text-emerald-400" x-text="activeLinkStats?.unique_visitors || activeLinkStats?.unique_clicks || 0"></span>
                            </div>
                            <div class="p-3 bg-wa-panel rounded-xl border border-wa-border text-center">
                                <span class="text-[10px] text-wa-muted block uppercase">Platform</span>
                                <span class="text-sm font-bold capitalize text-yellow-300" x-text="activeLinkStats?.link?.platform || '-'"></span>
                            </div>
                            <div class="p-3 bg-wa-panel rounded-xl border border-wa-border text-center">
                                <span class="text-[10px] text-wa-muted block uppercase">Status</span>
                                <span class="text-xs font-bold text-emerald-400">● Active 302</span>
                            </div>
                        </div>

                        <!-- Comprehensive Device Hardware & Location Breakdown -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            <!-- Device Brand & Model -->
                            <div class="p-3 bg-wa-panel rounded-xl border border-wa-border space-y-2">
                                <span class="text-xs font-bold text-white flex items-center justify-between">
                                    <span class="flex items-center gap-1.5"><i class="fas fa-mobile-alt text-cyan-400"></i> Model & Brand</span>
                                    <span class="text-[10px] text-wa-muted font-normal">Hardware</span>
                                </span>
                                <div class="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                                    <template x-for="(count, mdl) in (activeLinkStats?.model_breakdown || activeLinkStats?.device_breakdown || {})" :key="mdl">
                                        <div class="flex items-center justify-between text-wa-text hover:text-white">
                                            <span x-text="mdl" class="truncate max-w-[130px]" :title="mdl"></span>
                                            <span class="font-mono font-bold text-cyan-300" x-text="count + ' (' + Math.round((count/activeLinkStats.total_clicks)*100) + '%)'"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>

                            <!-- Operating System & Version -->
                            <div class="p-3 bg-wa-panel rounded-xl border border-wa-border space-y-2">
                                <span class="text-xs font-bold text-white flex items-center justify-between">
                                    <span class="flex items-center gap-1.5"><i class="fas fa-microchip text-indigo-400"></i> OS & Version</span>
                                    <span class="text-[10px] text-wa-muted font-normal">Platform</span>
                                </span>
                                <div class="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                                    <template x-for="(count, osName) in (activeLinkStats?.os_version_breakdown || activeLinkStats?.os_breakdown || {})" :key="osName">
                                        <div class="flex items-center justify-between text-wa-text hover:text-white">
                                            <span x-text="osName" class="truncate max-w-[130px]"></span>
                                            <span class="font-mono font-bold text-indigo-300" x-text="count + ' (' + Math.round((count/activeLinkStats.total_clicks)*100) + '%)'"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>

                            <!-- In-App Browser & Version -->
                            <div class="p-3 bg-wa-panel rounded-xl border border-wa-border space-y-2">
                                <span class="text-xs font-bold text-white flex items-center justify-between">
                                    <span class="flex items-center gap-1.5"><i class="fas fa-compass text-emerald-400"></i> App / Browser</span>
                                    <span class="text-[10px] text-wa-muted font-normal">Client</span>
                                </span>
                                <div class="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                                    <template x-for="(count, br) in (activeLinkStats?.browser_breakdown || {})" :key="br">
                                        <div class="flex items-center justify-between text-wa-text hover:text-white">
                                            <span x-text="br" class="truncate max-w-[130px]" :title="br"></span>
                                            <span class="font-mono font-bold text-emerald-400" x-text="count"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>

                            <!-- Telecom Carrier & City -->
                            <div class="p-3 bg-wa-panel rounded-xl border border-wa-border space-y-2">
                                <span class="text-xs font-bold text-white flex items-center justify-between">
                                    <span class="flex items-center gap-1.5"><i class="fas fa-tower-broadcast text-yellow-400"></i> Carrier & City</span>
                                    <span class="text-[10px] text-wa-muted font-normal">KSA Network</span>
                                </span>
                                <div class="space-y-1.5 text-xs max-h-36 overflow-y-auto pr-1">
                                    <template x-for="(count, cr) in (activeLinkStats?.carrier_breakdown || {})" :key="cr">
                                        <div class="flex items-center justify-between text-wa-text hover:text-white">
                                            <span x-text="cr" class="truncate max-w-[130px]" :title="cr"></span>
                                            <span class="font-mono font-bold text-yellow-300" x-text="count"></span>
                                        </div>
                                    </template>
                                    <template x-for="(count, ct) in (activeLinkStats?.city_breakdown || {})" :key="ct">
                                        <div class="flex items-center justify-between text-wa-muted text-[11px] pt-1 border-t border-wa-border/50">
                                            <span><i class="fas fa-map-marker-alt text-red-400 mr-1 text-[10px]"></i><span x-text="ct"></span></span>
                                            <span class="font-mono text-white" x-text="count"></span>
                                        </div>
                                    </template>
                                </div>
                            </div>
                        </div>

                        <!-- Real-time Click Stream (Recent 25 events) -->
                        <div class="space-y-2">
                            <span class="text-xs font-bold text-white flex items-center justify-between">
                                <span class="flex items-center gap-1.5"><i class="fas fa-history text-indigo-400"></i> Recent Visitor Clicks Stream</span>
                                <span class="text-[10px] text-wa-muted">Live 302 Ingestion with Whole Device Capture</span>
                            </span>
                            <div class="bg-wa-deep rounded-xl border border-wa-border overflow-hidden max-h-56 overflow-y-auto">
                                <table class="w-full text-left text-[11px]">
                                    <thead class="bg-wa-panel text-wa-muted border-b border-wa-border">
                                        <tr>
                                            <th class="py-2 px-3">Time</th>
                                            <th class="py-2 px-3">Platform</th>
                                            <th class="py-2 px-3">Device Model & Hardware</th>
                                            <th class="py-2 px-3">OS Version</th>
                                            <th class="py-2 px-3">App / Browser</th>
                                            <th class="py-2 px-3">City & Carrier</th>
                                            <th class="py-2 px-3">Visitor Hash</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-wa-border font-mono">
                                        <template x-for="c in (activeLinkStats?.recent_clicks || activeLinkStats?.recent_events || [])" :key="c.click_id || c.timestamp">
                                            <tr class="hover:bg-wa-surface/20 text-wa-muted">
                                                <td class="py-1.5 px-3 text-white" x-text="new Date(c.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})"></td>
                                                <td class="py-1.5 px-3 capitalize text-yellow-300" x-text="c.platform"></td>
                                                <td class="py-1.5 px-3 text-white font-sans font-medium" x-text="c.model || c.brand || c.device"></td>
                                                <td class="py-1.5 px-3 text-indigo-300" x-text="c.os_full || (c.os + (c.os_version ? ' ' + c.os_version : ''))"></td>
                                                <td class="py-1.5 px-3" x-text="c.browser_full || c.browser"></td>
                                                <td class="py-1.5 px-3 text-[10px] text-wa-text font-sans" x-text="(c.city || 'Riyadh') + ' • ' + (c.carrier || 'STC')"></td>
                                                <td class="py-1.5 px-3 text-[10px]" x-text="c.visitor_hash"></td>
                                            </tr>
                                        </template>
                                        <tr x-show="!(activeLinkStats?.recent_clicks?.length || activeLinkStats?.recent_events?.length)">
                                            <td colspan="7" class="py-4 text-center text-wa-muted">No clicks recorded yet. Share your link to start tracking!</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- MODAL: QR CODE GENERATOR -->
            <div x-show="showQrModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak>
                <div class="glass-panel w-full max-w-sm rounded-2xl border border-wa-border p-6 space-y-4 text-center relative shadow-2xl">
                    <div class="flex items-center justify-between border-b border-wa-border pb-3">
                        <h3 class="font-bold text-sm text-white flex items-center gap-2">
                            <i class="fas fa-qrcode text-indigo-400"></i>
                            <span>Tracking QR Code</span>
                        </h3>
                        <button @click="showQrModal = false" class="text-wa-muted hover:text-white p-1 cursor-pointer">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="p-4 bg-white rounded-2xl inline-block shadow-lg mx-auto">
                        <img 
                            :src="'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(activeQrUrl)" 
                            alt="QR Code" 
                            class="w-48 h-48 mx-auto"
                        >
                    </div>

                    <div class="space-y-1">
                        <h4 class="font-bold text-xs text-white" x-text="activeQrTitle"></h4>
                        <span class="text-[11px] text-indigo-300 font-mono block break-all" x-text="activeQrUrl"></span>
                    </div>

                    <div class="flex items-center justify-center gap-2 pt-2">
                        <button 
                            @click="copyTextToClipboard(activeQrUrl, 'URL copied!')" 
                            class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <i class="fas fa-copy"></i> Copy Link
                        </button>
                        <a 
                            :href="'https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=' + encodeURIComponent(activeQrUrl)" 
                            download="rush_tracking_qr.png" 
                            target="_blank"
                            class="px-4 py-2 bg-wa-surface hover:bg-wa-panel border border-wa-border text-wa-text rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                            <i class="fas fa-download"></i> High-Res PNG
                        </a>
                    </div>
                </div>
            </div>

            <!-- TAB 7: SETTINGS & PRICING -->
            <div x-show="activeTab === 'settings'" class="space-y-6" x-cloak>
                <div class="flex flex-wrap items-center justify-between gap-4">
                    <div>
                        <h2 class="text-lg font-bold text-white flex items-center gap-2">
                            <span>Unifonic &amp; WhatsApp Rate Cards &amp; Settings</span>
                            <span class="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 rounded-full font-bold">Billing Telemetry</span>
                        </h2>
                        <p class="text-xs text-wa-muted">Configure enterprise per-message rates, currency, and WABA credentials. Real-time cost analytics and campaign budgets calculate automatically.</p>
                    </div>
                    <button 
                        @click="saveSettings()" 
                        class="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black font-bold rounded-xl text-xs transition-all shadow-lg flex items-center gap-2 cursor-pointer"
                        :disabled="isSavingSettings"
                    >
                        <i class="fas fa-save" :class="{'fa-spin': isSavingSettings}"></i>
                        <span x-text="isSavingSettings ? 'Saving Changes...' : 'Save Pricing & Settings'"></span>
                    </button>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <!-- Rate Card Configuration -->
                    <div class="glass-panel p-6 rounded-2xl border border-wa-border space-y-5">
                        <div class="flex items-center gap-3 border-b border-wa-border pb-3">
                            <div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
                                <i class="fas fa-receipt text-sm"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-sm text-white">Message Rate Card</h3>
                                <p class="text-[11px] text-wa-muted">Contract rates billed by Unifonic per delivered Meta conversation</p>
                            </div>
                        </div>

                        <div class="space-y-4">
                            <!-- Currency -->
                            <div class="grid grid-cols-2 gap-3 items-center">
                                <div>
                                    <label class="block text-xs font-semibold text-white">Billing Currency</label>
                                    <span class="text-[10px] text-wa-muted">Currency code used in reports</span>
                                </div>
                                <select 
                                    x-model="settingsForm.currency" 
                                    class="bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 font-bold"
                                >
                                    <option value="SAR">SAR - Saudi Riyal (ر.س)</option>
                                    <option value="AED">AED - UAE Dirham (د.إ)</option>
                                    <option value="USD">USD - US Dollar ($)</option>
                                    <option value="KWD">KWD - Kuwaiti Dinar</option>
                                    <option value="BHD">BHD - Bahraini Dinar</option>
                                    <option value="QAR">QAR - Qatari Riyal</option>
                                    <option value="OMR">OMR - Omani Rial</option>
                                </select>
                            </div>

                            <!-- Marketing Rate -->
                            <div class="grid grid-cols-2 gap-3 items-center">
                                <div>
                                    <label class="block text-xs font-semibold text-white flex items-center gap-1.5">
                                        <span>Marketing Rate</span>
                                        <span class="text-[9px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded font-bold">Promotions</span>
                                    </label>
                                    <span class="text-[10px] text-wa-muted">Broadcasts, offers &amp; re-engagement</span>
                                </div>
                                <div class="relative">
                                    <input 
                                        type="number" 
                                        step="0.001" 
                                        min="0" 
                                        x-model="settingsForm.cost_marketing" 
                                        class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                                    >
                                    <span class="absolute right-3 top-2 text-[10px] text-wa-muted font-bold" x-text="settingsForm.currency || 'SAR'"></span>
                                </div>
                            </div>

                            <!-- Utility Rate -->
                            <div class="grid grid-cols-2 gap-3 items-center">
                                <div>
                                    <label class="block text-xs font-semibold text-white flex items-center gap-1.5">
                                        <span>Utility Rate</span>
                                        <span class="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold">Orders / Alerts</span>
                                    </label>
                                    <span class="text-[10px] text-wa-muted">Receipts, booking alerts, status updates</span>
                                </div>
                                <div class="relative">
                                    <input 
                                        type="number" 
                                        step="0.001" 
                                        min="0" 
                                        x-model="settingsForm.cost_utility" 
                                        class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                                    >
                                    <span class="absolute right-3 top-2 text-[10px] text-wa-muted font-bold" x-text="settingsForm.currency || 'SAR'"></span>
                                </div>
                            </div>

                            <!-- Authentication Rate -->
                            <div class="grid grid-cols-2 gap-3 items-center">
                                <div>
                                    <label class="block text-xs font-semibold text-white flex items-center gap-1.5">
                                        <span>Authentication Rate</span>
                                        <span class="text-[9px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded font-bold">OTP</span>
                                    </label>
                                    <span class="text-[10px] text-wa-muted">One-time passwords &amp; account verify</span>
                                </div>
                                <div class="relative">
                                    <input 
                                        type="number" 
                                        step="0.001" 
                                        min="0" 
                                        x-model="settingsForm.cost_auth" 
                                        class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                                    >
                                    <span class="absolute right-3 top-2 text-[10px] text-wa-muted font-bold" x-text="settingsForm.currency || 'SAR'"></span>
                                </div>
                            </div>

                            <!-- Service Rate -->
                            <div class="grid grid-cols-2 gap-3 items-center">
                                <div>
                                    <label class="block text-xs font-semibold text-white flex items-center gap-1.5">
                                        <span>Service Rate (Message 1,001+)</span>
                                        <span class="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold">1,000 Free/Mo</span>
                                    </label>
                                    <span class="text-[10px] text-wa-muted">Rate applied after 1,000 monthly free tier (Oct 1, 2026 Meta policy)</span>
                                </div>
                                <div class="relative">
                                    <input 
                                        type="number" 
                                        step="0.001" 
                                        min="0" 
                                        x-model="settingsForm.cost_service" 
                                        class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                                    >
                                    <span class="absolute right-3 top-2 text-[10px] text-wa-muted font-bold" x-text="settingsForm.currency || 'SAR'"></span>
                                </div>
                            </div>
                        </div>

                        <!-- Rule Notice -->
                        <div class="p-3 bg-wa-panel/80 rounded-xl border border-wa-border text-[11px] text-wa-muted space-y-1.5">
                            <div class="text-amber-400 font-semibold flex items-center gap-1">
                                <i class="fas fa-info-circle"></i> Meta / Unifonic Billing Rules (Effective Oct 1, 2026):
                            </div>
                            <ul class="list-disc list-inside space-y-1 text-[10px]">
                                <li>Charges apply only to successfully <strong>DELIVERED</strong> or <strong>READ</strong> messages.</li>
                                <li><strong>Free Monthly Service Tier:</strong> Each business phone number receives <strong>1,000 free delivered service messages per calendar month</strong> (<code class="text-sky-300">free_customer_service</code>, <code class="text-sky-300">billable: false</code>).</li>
                                <li><strong>Regular Charge (1,001+):</strong> Service messages exceeding the 1,000 allowance are billed as <code class="text-amber-300">regular</code> (<code class="text-amber-300">billable: true</code>) at the Service Rate above.</li>
                                <li>The 1,000 allowance resets at 12:00 AM on the 1st of each month with <strong>no rollover</strong>.</li>
                                <li>Failed, rejected, or undelivered messages are counted as <strong>0.00 SAR</strong>. Ensure a payment method is active in Meta Billing Hub to prevent delivery halts after 1,000 messages.</li>
                            </ul>
                        </div>
                    </div>

                    <!-- WABA & Unifonic Credentials -->
                    <div class="glass-panel p-6 rounded-2xl border border-wa-border space-y-5">
                        <div class="flex items-center gap-3 border-b border-wa-border pb-3">
                            <div class="w-8 h-8 rounded-xl bg-wa-green/10 text-wa-green-bright flex items-center justify-center">
                                <i class="fas fa-key text-sm"></i>
                            </div>
                            <div>
                                <h3 class="font-bold text-sm text-white">Unifonic WABA Integration</h3>
                                <p class="text-[11px] text-wa-muted">Credentials &amp; webhooks linking Unifonic and Chatwoot</p>
                            </div>
                        </div>

                        <div class="space-y-3.5">
                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-wa-muted">Unifonic Public ID (App SID)</label>
                                <input 
                                    type="text" 
                                    x-model="settingsForm.public_id" 
                                    placeholder="e.g. 569e5d95-..." 
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-wa-green"
                                >
                            </div>

                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-wa-muted">Unifonic Secret Key</label>
                                <input 
                                    type="password" 
                                    x-model="settingsForm.secret_key" 
                                    placeholder="••••••••••••••••" 
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-wa-green"
                                >
                                <span class="text-[10px] text-wa-muted">Leave unchanged to keep currently configured secret.</span>
                            </div>

                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-wa-muted">WABA Sender / Channel Number</label>
                                <input 
                                    type="text" 
                                    x-model="settingsForm.channel_id" 
                                    placeholder="e.g. 96653337736" 
                                    class="w-full bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-wa-green"
                                >
                            </div>

                            <div class="space-y-1">
                                <label class="text-xs font-semibold text-wa-muted">Public Webhook URL (Registered in Unifonic)</label>
                                <input 
                                    type="text" 
                                    x-model="settingsForm.https_webhook_url" 
                                    readonly 
                                    class="w-full bg-wa-panel/50 border border-wa-border rounded-xl px-3 py-2 text-xs text-wa-muted font-mono"
                                >
                            </div>

                            <div class="pt-2 flex items-center justify-between text-[11px]">
                                <span class="text-wa-muted">Database Engine:</span>
                                <span class="font-mono text-emerald-400" x-text="settingsForm.database"></span>
                            </div>
                        </div>

                        <div class="pt-3 border-t border-wa-border flex items-center justify-end">
                            <button 
                                @click="saveSettings()" 
                                class="px-5 py-2.5 bg-wa-green hover:bg-emerald-600 text-white font-bold rounded-xl text-xs shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                                :disabled="isSavingSettings"
                            >
                                <i class="fas fa-check-circle" :class="{'fa-spin': isSavingSettings}"></i>
                                <span x-text="isSavingSettings ? 'Saving...' : 'Apply & Persist Settings'"></span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

        </main>
    </div>

    <!-- NEW CAMPAIGN MODAL -->
    <div x-show="showNewCampaignModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak>
        <div class="glass-panel w-full max-w-xl rounded-2xl border border-wa-border p-6 space-y-5 relative shadow-2xl">
            <div class="flex items-center justify-between border-b border-wa-border pb-3">
                <h3 class="font-bold text-base text-white flex items-center gap-2">
                    <i class="fas fa-bullhorn text-wa-green-bright"></i>
                    Launch New Broadcast Campaign
                </h3>
                <button @click="showNewCampaignModal = false" class="text-wa-muted hover:text-white"><i class="fas fa-times"></i></button>
            </div>

            <div class="space-y-4">
                <!-- Select Pre-Approved Template -->
                <div class="space-y-1">
                    <label class="text-xs font-semibold text-wa-muted">Pre-Approved Template</label>
                    <select 
                        @change="onModalTemplateSelect($event.target.value)" 
                        class="w-full bg-wa-panel border border-wa-border rounded-xl px-4 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green"
                    >
                        <option value="">-- Choose from Pre-Approved Meta Templates --</option>
                        <template x-for="t in templates" :key="t.name">
                            <option :value="t.name" x-text="t.name + ' (' + (t.category || 'MARKETING') + ' - ' + (t.language || 'AR') + ')'"></option>
                        </template>
                    </select>
                </div>

                <div class="space-y-1">
                    <label class="text-xs font-semibold text-wa-muted">Campaign Name</label>
                    <input type="text" x-model="newCampaign.name" placeholder="e.g. VIP National Day Offer" class="w-full bg-wa-panel border border-wa-border rounded-xl px-4 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green">
                </div>

                <!-- Detected Template Variables Helper -->
                <template x-if="getDetectedCampaignVariables().length > 0">
                    <div class="p-3 bg-wa-panel rounded-xl border border-sky-500/30 space-y-2">
                        <div class="flex items-center justify-between text-xs">
                            <span class="font-bold text-sky-400 flex items-center gap-1.5">
                                <i class="fas fa-magic"></i>
                                <span>Template Variables Detected:</span>
                            </span>
                            <span class="text-[10px] text-wa-muted">Set default fallback values if omitted per customer</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <template x-for="v in getDetectedCampaignVariables()" :key="v">
                                <div class="flex items-center gap-2 bg-wa-surface px-3 py-1.5 rounded-lg border border-wa-border text-xs">
                                    <span class="font-mono text-wa-green-bright font-bold shrink-0" x-text="'{{' + v + '}}:'"></span>
                                    <input 
                                        type="text" 
                                        x-model="newCampaign.defaultVars[v]" 
                                        :placeholder="'Default for {{' + v + '}}'" 
                                        class="bg-transparent border-none text-xs text-white focus:outline-none w-full font-arabic"
                                    >
                                </div>
                            </template>
                        </div>
                    </div>
                </template>

                <div class="space-y-1">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-semibold text-wa-muted">Customer Audience &amp; Variables</label>
                        <div class="flex items-center gap-3">
                            <button 
                                type="button" 
                                @click="downloadCampaignCSVTemplate()" 
                                class="text-[11px] text-emerald-400 hover:text-emerald-300 cursor-pointer flex items-center gap-1 font-medium transition-colors"
                                title="Download sample CSV formatted with template columns and variables"
                            >
                                <i class="fas fa-file-download"></i>
                                <span>Download CSV Template</span>
                            </button>
                            <label class="text-[11px] text-sky-400 hover:text-white cursor-pointer flex items-center gap-1">
                                <i class="fas fa-file-csv"></i>
                                <span>Import CSV / TXT</span>
                                <input type="file" class="hidden" accept=".csv,.txt" @change="handleCampaignCSVUpload($event)">
                            </label>
                        </div>
                    </div>
                    <textarea 
                        x-model="newCampaign.rawNumbers" 
                        rows="4" 
                        placeholder="Format: Phone, Var1, Var2...&#10;0569809578, FIRSTWASH-123, محمد&#10;966553337736, RUSH96, أحمد" 
                        class="w-full bg-wa-panel border border-wa-border rounded-xl p-3 text-xs text-wa-text font-mono focus:outline-none focus:border-wa-green font-arabic"
                    ></textarea>
                    <div class="flex items-center justify-between text-[10px] text-wa-muted">
                        <span>Format: <code>Phone, Var1, Var2...</code> (Comma, Tab, Pipe separated)</span>
                        <strong class="text-wa-green-bright" x-text="parseCampaignRecipients().length + ' recipients detected'"></strong>
                    </div>
                </div>

                <!-- Live Sample Preview of Personalized Messages -->
                <template x-if="parseCampaignRecipients().length > 0">
                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between text-[11px] text-wa-muted font-bold uppercase tracking-wider">
                            <span>Audience Preview (First <span x-text="Math.min(3, parseCampaignRecipients().length)"></span> of <span x-text="parseCampaignRecipients().length"></span>)</span>
                            <span>Personalized Output</span>
                        </div>
                        <div class="max-h-24 overflow-y-auto rounded-xl border border-wa-border bg-wa-panel/60 divide-y divide-wa-border/50 text-[11px]">
                            <template x-for="(rec, idx) in parseCampaignRecipients().slice(0, 3)" :key="idx">
                                <div class="p-2 flex items-center justify-between gap-3">
                                    <span class="font-mono text-emerald-400 shrink-0 font-bold" x-text="rec.phone"></span>
                                    <span class="text-wa-muted truncate max-w-xs font-arabic" dir="rtl" x-text="getCampaignRecipientPreview(rec)"></span>
                                </div>
                            </template>
                        </div>
                    </div>
                </template>

                <!-- Media Attachment with VPS Upload & Vault Picker -->
                <div class="space-y-1">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-semibold text-wa-muted">Header Media URL (Optional Banner/Photo)</label>
                        <div class="flex items-center gap-3">
                            <button type="button" @click="openVaultPicker('campaign')" class="text-[11px] text-sky-400 hover:underline cursor-pointer flex items-center gap-1">
                                <i class="fas fa-photo-video"></i>
                                <span>Choose from Vault</span>
                            </button>
                            <label class="text-[11px] text-wa-green-bright hover:underline cursor-pointer flex items-center gap-1">
                                <i class="fas fa-cloud-upload-alt"></i>
                                <span>Upload New</span>
                                <input type="file" class="hidden" accept="image/*,video/*,application/pdf" @change="uploadMediaFile($event, 'campaign')">
                            </label>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <input 
                            type="text" 
                            x-model="newCampaign.mediaUrl" 
                            placeholder="https://whatsapp.rush.com.sa/uploads/banner.jpg" 
                            class="flex-1 bg-wa-panel border border-wa-border rounded-xl px-4 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green font-mono"
                        >
                        <template x-if="newCampaign.mediaUrl">
                            <button @click="newCampaign.mediaUrl = ''" class="p-2 text-wa-muted hover:text-rose-400">
                                <i class="fas fa-times"></i>
                            </button>
                        </template>
                    </div>
                    <template x-if="newCampaign.mediaUrl">
                        <div class="p-2 rounded-xl bg-wa-surface border border-wa-border flex items-center gap-2 mt-1 max-h-20">
                            <img :src="newCampaign.mediaUrl" alt="Campaign Banner" class="w-12 h-12 object-cover rounded-lg">
                            <span class="text-[11px] text-wa-muted font-mono truncate" x-text="newCampaign.mediaUrl"></span>
                        </div>
                    </template>
                </div>

                <div class="space-y-1">
                    <label class="text-xs font-semibold text-wa-muted">Message Template Body</label>
                    <textarea 
                        x-model="newCampaign.template" 
                        rows="4" 
                        placeholder="أهلاً بك {{1}} في مغسلة رش! يسعدنا تقديم عرض خاص..." 
                        class="w-full bg-wa-panel border border-wa-border rounded-xl p-3 text-xs text-wa-text font-arabic focus:outline-none focus:border-wa-green"
                        dir="rtl"
                    ></textarea>
                </div>
            </div>

            <div class="flex items-center justify-between pt-3 border-t border-wa-border">
                <div class="flex items-center gap-2">
                    <span class="text-xs text-wa-muted">Est. Campaign Cost:</span>
                    <span class="text-xs font-mono font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg" x-text="getEstimatedCampaignCost() + ' ' + (stats.currency || 'SAR') + ' (' + (parseCampaignRecipients().length) + ' recipients)'"></span>
                </div>
                <div class="flex items-center gap-3">
                    <button @click="showNewCampaignModal = false" class="px-4 py-2 text-xs text-wa-muted hover:text-white">Cancel</button>
                    <button 
                        @click="launchCampaign()" 
                        class="px-5 py-2.5 bg-wa-green hover:bg-emerald-600 text-white font-bold rounded-xl text-xs shadow-lg shadow-wa-green/20 flex items-center gap-2"
                    >
                        <i class="fas fa-paper-plane"></i>
                        <span>Start Broadcast</span>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- CREATE TEMPLATE VIA API MODAL -->
    <div x-show="showCreateTemplateModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak>
        <div class="glass-panel w-full max-w-2xl rounded-2xl border border-wa-border p-6 space-y-5 relative shadow-2xl max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between border-b border-wa-border pb-3">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-wa-green/20 border border-wa-green/30 flex items-center justify-center text-wa-green-bright text-sm">
                        <i class="fas fa-magic"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-base text-white">Create WhatsApp Template via API</h3>
                        <p class="text-[11px] text-wa-muted">Register Meta/Unifonic compatible templates with dynamic variables &amp; media.</p>
                    </div>
                </div>
                <button @click="showCreateTemplateModal = false" class="text-wa-muted hover:text-white"><i class="fas fa-times"></i></button>
            </div>

            <!-- Tab Switcher (Form vs cURL Code) -->
            <div class="flex items-center bg-wa-panel p-1 rounded-xl border border-wa-border">
                <button 
                    @click="createTemplateTab = 'form'" 
                    class="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2"
                    :class="createTemplateTab === 'form' ? 'bg-wa-surface text-wa-green-bright shadow font-bold' : 'text-wa-muted hover:text-white'"
                >
                    <i class="fas fa-edit"></i>
                    <span>Template Form</span>
                </button>
                <button 
                    @click="createTemplateTab = 'api'" 
                    class="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2"
                    :class="createTemplateTab === 'api' ? 'bg-wa-surface text-wa-green-bright shadow font-bold' : 'text-wa-muted hover:text-white'"
                >
                    <i class="fas fa-terminal"></i>
                    <span>REST API &amp; cURL Command</span>
                </button>
            </div>

            <!-- Form Mode -->
            <div x-show="createTemplateTab === 'form'" class="space-y-4">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="space-y-1">
                        <label class="text-xs font-semibold text-wa-muted">Template Name <span class="text-rose-400">*</span></label>
                        <input 
                            type="text" 
                            x-model="newTemplateForm.name" 
                            placeholder="e.g. rush_vip_discount" 
                            class="w-full bg-wa-panel border border-wa-border rounded-xl px-4 py-2 text-xs text-wa-text font-mono focus:outline-none focus:border-wa-green"
                        >
                        <span class="text-[10px] text-wa-muted">Only lowercase letters, numbers, and underscores (Meta requirement).</span>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted">Category</label>
                            <select x-model="newTemplateForm.category" class="w-full bg-wa-panel border border-wa-border rounded-xl px-2.5 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green">
                                <option value="MARKETING">Marketing</option>
                                <option value="UTILITY">Utility</option>
                                <option value="AUTHENTICATION">Auth</option>
                            </select>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted">Language</label>
                            <select x-model="newTemplateForm.language" class="w-full bg-wa-panel border border-wa-border rounded-xl px-2.5 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green">
                                <option value="ar">Arabic (ar)</option>
                                <option value="en">English (en)</option>
                            </select>
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-semibold text-wa-muted">Review Status</label>
                            <select x-model="newTemplateForm.status" class="w-full bg-wa-panel border border-wa-border rounded-xl px-2 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green font-semibold text-amber-400">
                                <option value="IN_REVIEW">In Review</option>
                                <option value="APPROVED">Approved</option>
                                <option value="PENDING">Pending</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Message Body -->
                <div class="space-y-1">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-semibold text-wa-muted">Message Body <span class="text-rose-400">*</span></label>
                        <div class="flex items-center gap-1.5 text-[10px]">
                            <span class="text-wa-muted">Insert:</span>
                            <button type="button" @click="insertVariableInNewTemplate('{{1}}')" class="px-1.5 py-0.5 rounded bg-wa-surface border border-wa-border text-wa-green-bright hover:bg-wa-panel">+ {{1}} Name</button>
                            <button type="button" @click="insertVariableInNewTemplate('{{2}}')" class="px-1.5 py-0.5 rounded bg-wa-surface border border-wa-border text-wa-green-bright hover:bg-wa-panel">+ {{2}} Code</button>
                        </div>
                    </div>
                    <textarea 
                        x-model="newTemplateForm.body" 
                        rows="4" 
                        placeholder="أهلاً بك {{1}} في مغسلة رش! يسعدنا تقديم كود خصم خاص {{2}}..." 
                        class="w-full bg-wa-panel border border-wa-border rounded-xl p-3.5 text-xs text-wa-text font-arabic focus:outline-none focus:border-wa-green leading-relaxed"
                        dir="rtl"
                    ></textarea>
                </div>

                <!-- Header Media Attachment with Choose from Vault -->
                <div class="space-y-1">
                    <div class="flex items-center justify-between">
                        <label class="text-xs font-semibold text-wa-muted">Header Media URL (Optional Image/Banner)</label>
                        <div class="flex items-center gap-3">
                            <button type="button" @click="openVaultPicker('create_template')" class="text-[11px] text-sky-400 hover:underline cursor-pointer flex items-center gap-1">
                                <i class="fas fa-photo-video"></i>
                                <span>Choose from Vault</span>
                            </button>
                            <label class="text-[11px] text-wa-green-bright hover:underline cursor-pointer flex items-center gap-1">
                                <i class="fas fa-cloud-upload-alt"></i>
                                <span>Upload New</span>
                                <input type="file" class="hidden" accept="image/*,video/*,application/pdf" @change="uploadMediaFile($event, 'create_template')">
                            </label>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <input 
                            type="text" 
                            x-model="newTemplateForm.mediaUrl" 
                            placeholder="https://whatsapp.rush.com.sa/uploads/banner.jpg" 
                            class="flex-1 bg-wa-panel border border-wa-border rounded-xl px-4 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green font-mono"
                        >
                        <template x-if="newTemplateForm.mediaUrl">
                            <button @click="newTemplateForm.mediaUrl = ''" class="p-2 text-wa-muted hover:text-rose-400">
                                <i class="fas fa-times"></i>
                            </button>
                        </template>
                    </div>
                </div>

                <!-- Action Button -->
                <div class="space-y-1.5 pt-1">
                    <label class="text-xs font-semibold text-wa-muted">Call to Action Button (Optional)</label>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select x-model="newTemplateForm.buttonType" class="bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green">
                            <option value="URL">Visit Website (URL)</option>
                            <option value="QUICK_REPLY">Quick Reply</option>
                        </select>
                        <input 
                            type="text" 
                            x-model="newTemplateForm.buttonText" 
                            placeholder="Button Text (e.g. اشترك الآن)" 
                            class="bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green font-arabic"
                            dir="rtl"
                        >
                        <input 
                            type="text" 
                            x-model="newTemplateForm.buttonUrl" 
                            placeholder="https://rush.com.sa" 
                            class="bg-wa-panel border border-wa-border rounded-xl px-3 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green font-mono"
                        >
                    </div>
                </div>
            </div>

            <!-- Developer API / cURL Mode -->
            <div x-show="createTemplateTab === 'api'" class="space-y-3" x-cloak>
                <div class="flex items-center justify-between">
                    <span class="text-xs text-wa-muted font-medium">Programmatic REST API Endpoint:</span>
                    <button 
                        @click="copyCurlSnippet()" 
                        class="px-2.5 py-1 bg-wa-surface hover:bg-wa-panel text-white rounded-lg text-xs font-semibold border border-wa-border flex items-center gap-1.5 transition-colors"
                    >
                        <i class="fas fa-copy text-wa-green-bright"></i>
                        <span>Copy cURL</span>
                    </button>
                </div>
                <div class="relative bg-black/60 rounded-xl p-4 border border-wa-border font-mono text-[11px] text-emerald-400 overflow-x-auto leading-relaxed max-h-64 whitespace-pre">
                    <code x-text="getCurlCodeSnippet()"></code>
                </div>
                <div class="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[11px] text-blue-300 space-y-1">
                    <p class="font-bold flex items-center gap-1.5">
                        <i class="fas fa-info-circle"></i> Direct API Automation:
                    </p>
                    <p class="text-blue-300/80">Send a <code class="bg-blue-900/40 px-1 py-0.5 rounded text-white font-mono">POST /api/templates</code> request with this payload from your backend, CRM, or automated workflow to create templates on-demand.</p>
                </div>
            </div>

            <div class="flex items-center justify-end gap-3 pt-3 border-t border-wa-border">
                <button @click="showCreateTemplateModal = false" class="px-4 py-2 text-xs text-wa-muted hover:text-white">Cancel</button>
                <button 
                    @click="submitCreateTemplate()" 
                    class="px-5 py-2.5 bg-gradient-to-r from-wa-green to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl text-xs shadow-lg shadow-wa-green/20 flex items-center gap-2"
                    :disabled="isSubmittingTemplate"
                >
                    <i class="fas fa-spinner fa-spin" x-show="isSubmittingTemplate"></i>
                    <i class="fas fa-check-circle" x-show="!isSubmittingTemplate"></i>
                    <span x-text="isSubmittingTemplate ? 'Creating Template...' : 'Save &amp; Register Template'"></span>
                </button>
            </div>
        </div>
    </div>

    <!-- MEDIA VAULT PICKER MODAL -->
    <div x-show="showVaultPickerModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" x-cloak>
        <div class="glass-panel w-full max-w-3xl rounded-2xl border border-wa-border p-6 space-y-4 relative shadow-2xl max-h-[85vh] flex flex-col">
            <!-- Modal Header -->
            <div class="flex items-center justify-between border-b border-wa-border pb-3 shrink-0">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 text-sm">
                        <i class="fas fa-photo-video"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-base text-white">Choose Media from VPS Vault</h3>
                        <p class="text-[11px] text-wa-muted">Select an uploaded image, video, or document to attach immediately.</p>
                    </div>
                </div>
                <button @click="showVaultPickerModal = false" class="text-wa-muted hover:text-white"><i class="fas fa-times"></i></button>
            </div>

            <!-- Search & Quick Upload Toolbar -->
            <div class="flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div class="w-full sm:w-72">
                    <input 
                        type="text" 
                        x-model="vaultSearchQuery" 
                        placeholder="Search media files..." 
                        class="w-full bg-wa-panel border border-wa-border rounded-xl px-3.5 py-2 text-xs text-wa-text focus:outline-none focus:border-wa-green"
                    >
                </div>
                <label class="px-3.5 py-2 bg-wa-surface hover:bg-wa-panel text-wa-green-bright rounded-xl text-xs font-bold border border-wa-border flex items-center gap-2 cursor-pointer transition-colors shadow">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <span>Upload New to Vault</span>
                    <input type="file" class="hidden" accept="image/*,video/*,application/pdf" @change="uploadMediaFile($event, 'vault_picker')">
                </label>
            </div>

            <!-- Files Grid -->
            <div class="flex-1 overflow-y-auto min-h-[300px]">
                <template x-if="filteredVaultUploads().length === 0">
                    <div class="py-16 text-center text-wa-muted space-y-2">
                        <i class="fas fa-folder-open text-4xl opacity-40"></i>
                        <p class="text-xs">No media files found in Vault.</p>
                    </div>
                </template>

                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                    <template x-for="item in filteredVaultUploads()" :key="item.filename">
                        <div 
                            @click="selectVaultMedia(item.url)"
                            class="glass-panel p-2.5 rounded-xl border border-wa-border hover:border-wa-green/60 cursor-pointer transition-all hover:scale-[1.02] flex flex-col justify-between group shadow"
                        >
                            <!-- Thumbnail -->
                            <div class="w-full h-28 rounded-lg overflow-hidden bg-black/40 border border-white/5 flex items-center justify-center relative">
                                <template x-if="item.is_image">
                                    <img :src="item.url" :alt="item.filename" class="w-full h-full object-cover">
                                </template>
                                <template x-if="!item.is_image">
                                    <div class="text-center p-2 text-wa-muted">
                                        <i class="fas fa-file-pdf text-rose-400 text-3xl mb-1"></i>
                                        <span class="text-[10px] block truncate font-mono" x-text="item.filename"></span>
                                    </div>
                                </template>
                                <div class="absolute inset-0 bg-wa-green/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <span class="px-2.5 py-1 rounded-lg bg-wa-green text-white font-bold text-[11px] shadow">Select</span>
                                </div>
                            </div>

                            <!-- Meta -->
                            <div class="pt-2">
                                <span class="font-mono text-[11px] text-white truncate block" x-text="item.filename"></span>
                                <div class="flex items-center justify-between text-[10px] text-wa-muted pt-0.5">
                                    <span x-text="item.size || ''"></span>
                                    <span x-text="formatDate(item.uploaded_at)"></span>
                                </div>
                            </div>
                        </div>
                    </template>
                </div>
            </div>

            <!-- Modal Footer -->
            <div class="flex items-center justify-between pt-3 border-t border-wa-border shrink-0">
                <span class="text-xs text-wa-muted">
                    Total Assets: <strong class="text-white" x-text="uploads.length"></strong>
                </span>
                <button @click="showVaultPickerModal = false" class="px-4 py-2 text-xs text-wa-muted hover:text-white">Close</button>
            </div>
        </div>
    </div>

    </body>
</html>
"""
