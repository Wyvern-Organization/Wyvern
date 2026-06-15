// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // WYVERN FRONTEND v1
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    //
    // BACKEND_URL: set to a full URL (e.g. "https://api.wyvern.app") to point to
    // a remote server. Leave as null to use relative paths (same-origin hosting).
    //
    // Example: const BACKEND_URL_FALLBACK = "https://api.wyvern.app";
    //
    // ─── Config ───────────────────────────────────────────────────────────────────
    // Set BACKEND_URL to a full URL (e.g. "https://api.wyvern.app") to point to a
    // remote server. Leave as null to use relative paths (same origin).
    const APP_CONFIG = window.WYVERN_BOOTSTRAP || {};
    const BACKEND_URL_FALLBACK = APP_CONFIG.backendUrl ?? null;
    const EDGE_MODE_STORAGE_KEY = 'wyvern_edge_mode_enabled';
    const DEFAULT_EDGE_PATH_PREFIX = '/edge';
    let runtimeConfig = {
      backend_url: null,
      client_mode: 'stable',
      release_channel: 'stable',
      node_role: 'main',
      edge_mode_enabled: false,
      sync_peer_api_url: null,
      edge_mode_available: false,
      bridge_schema_version: 1,
      sync_enabled: false,
      wyv_public_base_url: null,
      feature_flags: {},
      giphy_api_key: null,
      giphy_rating: 'g',
      giphy_limit: 24,
      bridge_health: null,
      legal: {
        terms_version: '2026-05-22',
        privacy_version: '2026-05-22',
        effective_date: '2026-05-22',
        effective_date_label: 'May 22, 2026',
        terms_url: `${window.location.origin}/legal/terms`,
        privacy_url: `${window.location.origin}/legal/privacy`,
        legal_contact_email: 'legal@wyvernhub.net',
        support_contact_email: 'support@wyvernhub.net',
        operator_name: 'Wyvern Team',
      },
    };
    let resolvedShellRefresh = APP_CONFIG.forceShellVariant === 'modern'
      ? true
      : (APP_CONFIG.forceShellVariant === 'legacy' ? false : null);

    const WYVERN_LOGO_URL = APP_CONFIG.logoUrl || '/static/wyvern-logo.png';
    const WYVERN_SECTION_LOGO_URL = APP_CONFIG.sectionLogoUrl || WYVERN_LOGO_URL;

    function base(path) {
      const backendUrl = BACKEND_URL_FALLBACK;
      return backendUrl ? `${backendUrl}${path}` : path;
    }

    function apiPrefix() {
      return currentClientMode() === 'edge' ? '/edge/api/v1' : '/api/v1';
    }

    function featureFlagEnabled(key) {
      return !!runtimeConfig?.feature_flags?.[key];
    }

    function shellRefreshEnabled() {
      if (resolvedShellRefresh == null) {
        resolvedShellRefresh = featureFlagEnabled('shell_refresh');
      }
      return !!resolvedShellRefresh;
    }

    function isEdgeModeEnabled() {
      try { return localStorage.getItem(EDGE_MODE_STORAGE_KEY) === '1'; }
      catch { return false; }
    }

    function setEdgeModeEnabled(enabled) {
      try {
        if (enabled) localStorage.setItem(EDGE_MODE_STORAGE_KEY, '1');
        else localStorage.removeItem(EDGE_MODE_STORAGE_KEY);
      } catch { }
    }

    function edgePathPrefix() {
      return DEFAULT_EDGE_PATH_PREFIX;
    }

    function edgeChooserRoute() {
      return APP_CONFIG.edgeChooserRoute || edgePathPrefix();
    }

    function currentUiVariantKey() {
      return String(APP_CONFIG.uiVariantKey || '').trim();
    }

    function isUiA() {
      return currentUiVariantKey() === 'ui_a';
    }

    function buildEdgeChooserHref() {
      const url = new URL(edgeChooserRoute(), window.location.origin);
      const params = new URLSearchParams(window.location.search);
      for (const key of ['embedded', 'edgeParentOrigin', 'edgeBridgeVersion']) {
        const value = params.get(key);
        if (value) url.searchParams.set(key, value);
      }
      if (currentClientMode() === 'edge') {
        url.searchParams.set('uiReturn', window.location.pathname);
      }
      return url.toString();
    }

    function currentClientMode() {
      const prefix = edgePathPrefix();
      const pathname = window.location.pathname || '/';
      return pathname === prefix || pathname.startsWith(`${prefix}/`) ? 'edge' : 'stable';
    }

    function websocketPath() {
      return currentClientMode() === 'edge' ? '/edge/ws' : '/ws';
    }

    function idKey(value) {
      if (value === null || value === undefined) return '';
      const normalized = String(value).trim();
      return normalized && normalized !== '0' && normalized !== 'null' && normalized !== 'undefined' ? normalized : '';
    }

    function idsEqual(left, right) {
      const leftKey = idKey(left);
      return !!leftKey && leftKey === idKey(right);
    }

    function createEdgeUiLabLink() {
      if (currentClientMode() !== 'edge' || !currentUiVariantKey()) return null;
      return el('a', {
        class: 'edge-ui-lab-link',
        href: buildEdgeChooserHref(),
        title: 'Return to the Edge UI chooser',
      }, 'Compare UIs');
    }

    function edgeModeCanBoot() {
      return runtimeConfig?.client_mode !== 'edge' && !!runtimeConfig?.edge_mode_available && !!runtimeConfig?.edge_mode_enabled;
    }

    function resolveAuthedView() {
      if (runtimeConfig?.client_mode === 'edge') return 'app';
      return isEdgeModeEnabled() && edgeModeCanBoot() ? 'edge-shell' : 'app';
    }

    function legalConfig() {
      const configuredBase = String(runtimeConfig?.backend_url || BACKEND_URL_FALLBACK || window.location.origin || '').replace(/\/+$/, '');
      const legal = runtimeConfig?.legal || {};
      return {
        terms_version: String(legal.terms_version || '2026-05-22'),
        privacy_version: String(legal.privacy_version || '2026-05-22'),
        effective_date: String(legal.effective_date || '2026-05-22'),
        effective_date_label: String(legal.effective_date_label || 'May 22, 2026'),
        terms_url: String(legal.terms_url || `${configuredBase}/legal/terms`),
        privacy_url: String(legal.privacy_url || `${configuredBase}/legal/privacy`),
        legal_contact_email: String(legal.legal_contact_email || 'legal@wyvernhub.net'),
        support_contact_email: String(legal.support_contact_email || 'support@wyvernhub.net'),
        operator_name: String(legal.operator_name || 'Wyvern Team'),
      };
    }

    function wyvPublicBaseUrl() {
      return String(runtimeConfig?.wyv_public_base_url || '').trim().replace(/\/+$/, '');
    }

    function wyvContinueTarget() {
      const params = new URLSearchParams(window.location.search);
      return String(params.get('wyv_continue') || '').trim();
    }

    function resolvePostAuthView(user) {
      return user?.legal_reaccept_required ? 'legal' : resolveAuthedView();
    }

    function viewerCanSeeNsfw() {
      return !!store.state.user?.nsfw_18_verified;
    }

    async function loadRuntimeConfig() {
      try {
        const mode = currentClientMode();
        const response = await fetch(`${apiPrefix()}/runtime-config?mode=${encodeURIComponent(mode)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        const data = payload?.data || payload || {};
        runtimeConfig = { ...runtimeConfig, ...data };
        runtimeConfig.feature_flags = { ...(runtimeConfig.feature_flags || {}), ...(data.feature_flags || {}) };
        runtimeConfig.legal = { ...(runtimeConfig.legal || {}), ...(data.legal || {}) };
        if (resolvedShellRefresh == null) {
          resolvedShellRefresh = featureFlagEnabled('shell_refresh');
        }
      } catch { }
    }

    // ─── Token Storage ────────────────────────────────────────────────────────────
    function tokenStorageKeys() {
      if (currentClientMode() === 'edge') {
        return { access: 'wy_edge_access', refresh: 'wy_edge_refresh' };
      }
      return { access: 'wy_access', refresh: 'wy_refresh' };
    }

    const token = {
      get access() { return sessionStorage.getItem(tokenStorageKeys().access); },
      get refresh() { return sessionStorage.getItem(tokenStorageKeys().refresh); },
      set(access, refresh) {
        const keys = tokenStorageKeys();
        sessionStorage.setItem(keys.access, access);
        if (refresh) sessionStorage.setItem(keys.refresh, refresh);
      },
      clear() {
        const keys = tokenStorageKeys();
        sessionStorage.removeItem(keys.access);
        sessionStorage.removeItem(keys.refresh);
      }
    };

    // ─── Core Fetch ───────────────────────────────────────────────────────────────
    async function req(method, path, body, opts = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (token.access) headers['Authorization'] = `Bearer ${token.access}`;

      const res = await fetch(base(`${apiPrefix()}${path}`), {
        method,
        headers: opts.noContentType ? { Authorization: headers.Authorization } : headers,
        body: body && !opts.noContentType ? JSON.stringify(body) : body,
      });

      if (res.status === 401 && !opts.noRefresh) {
        const refreshed = await tryRefresh();
        if (refreshed) return req(method, path, body, { ...opts, noRefresh: true });
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = data?.error || { message: res.statusText };
        if (res.status === 403 && error?.code === 'LEGAL_RECONSENT_REQUIRED') {
          const existingUser = store?.state?.user || null;
          store.set({
            isAuthed: true,
            view: 'legal',
            user: existingUser ? { ...existingUser, legal_reaccept_required: true } : existingUser,
          });
        }
        throw error;
      }
      return data.data ?? data;
    }

    async function tryRefresh() {
      if (!token.refresh) return false;
      try {
        const res = await fetch(base(`${apiPrefix()}/auth/refresh`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: token.refresh }),
        });
        if (!res.ok) { token.clear(); return false; }
        const d = await res.json();
        const access = d.data?.tokens?.access_token || d.data?.access_token || d.access_token;
        const refresh = d.data?.tokens?.refresh_token || d.data?.refresh_token || d.refresh_token;
        if (!access) { token.clear(); return false; }
        token.set(access, refresh);
        return true;
      } catch { token.clear(); return false; }
    }

    // ─── Auth ─────────────────────────────────────────────────────────────────────
    const auth = {
      register: (username, email, password, displayName = null, legalAcceptance = null) =>
        req('POST', '/auth/register', {
          username,
          email,
          password,
          display_name: displayName || undefined,
          accepted_legal: !!legalAcceptance?.acceptedLegal,
          terms_version: legalAcceptance?.termsVersion,
          privacy_version: legalAcceptance?.privacyVersion,
        }),
      login: async (email, password) => {
        const d = await req('POST', '/auth/login', { email, password });
        const access = d.tokens?.access_token || d.access_token;
        const refresh = d.tokens?.refresh_token || d.refresh_token;
        if (!access) throw new Error('Login response missing access token');
        token.set(access, refresh);
        return d;
      },
      logout: async () => {
        const refresh = token.refresh;
        if (refresh) {
          await req('POST', '/auth/logout', { refresh_token: refresh }).catch(() => { });
        }
        token.clear();
      },
      wyvHandoff: () => req('POST', '/auth/wyv-handoff'),
      edgeHandoff: () => req('POST', '/auth/edge-handoff'),
      edgeExchange: (grant) => req('POST', '/auth/edge-exchange', { grant }),
    };

    async function maybeLaunchWyvFromQuery() {
      const target = wyvContinueTarget();
      const wyvBase = wyvPublicBaseUrl();
      if (!target || !wyvBase || !token.access) return false;
      const handoff = await auth.wyvHandoff();
      const grant = handoff?.grant || handoff?.data?.grant || handoff?.handoff;
      if (!grant) throw new Error('Wyv handoff did not return a grant');
      const destination = new URL('/auth/callback', wyvBase);
      destination.searchParams.set('grant', grant);
      destination.searchParams.set('return_to', target);
      window.location.replace(destination.toString());
      return true;
    }

    async function signOutUser() {
      const refreshToken = token.refresh;
      try {
        void leaveVoiceChannel(true);
      } catch { }

      socket?.disconnect();
      token.clear();
      store.set({
        user: null,
        isAuthed: false,
        view: 'auth',
        activeServerId: null,
        activeChannelId: null,
        activeDmId: null,
        activeVoiceChannelId: null,
        sidebarMode: 'servers',
        wsConnected: false,
      });

      if (refreshToken) {
        void fetch(base(`${apiPrefix()}/auth/logout`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        }).catch(() => { });
      }
    }

    // ─── Users ────────────────────────────────────────────────────────────────────
    const users = {
      me: () => req('GET', '/users/me'),
      update: (body) => req('PATCH', '/users/me', body),
      acceptLegal: (body) => req('POST', '/legal/accept', body),
      setPresence: (status) => req('PUT', '/users/me/presence', { status }),
      readStates: () => req('GET', '/users/me/read-states'),
      get: (id) => req('GET', `/users/${id}`),
      getPresence: (id) => req('GET', `/users/${id}/presence`),
      lookup: (query) => req('GET', `/users/lookup?q=${encodeURIComponent(query)}`),
      directory: ({ recommended = false } = {}) => req('GET', `/users/directory${recommended ? '?recommended=true' : ''}`),
    };
    const ai = {
      mcp: {
        get: () => req('GET', '/ai/mcp-connection'),
        create: () => req('POST', '/ai/mcp-connection'),
        revoke: () => req('DELETE', '/ai/mcp-connection'),
      },
      apiTokens: {
        list: () => req('GET', '/ai/api-tokens'),
        create: (name) => req('POST', '/ai/api-tokens', { name }),
        revoke: (tokenId) => req('DELETE', `/ai/api-tokens/${tokenId}`),
        rotate: (tokenId) => req('POST', `/ai/api-tokens/${tokenId}/rotate`),
        revokeAll: () => req('POST', '/ai/api-tokens/revoke-all'),
        rotateAll: () => req('POST', '/ai/api-tokens/rotate-all'),
      },
    };
    const userCache = new Map();
    const userFetchInFlight = new Map();
    const USER_CACHE_MAX = 320;

    function trimUserCache() {
      while (userCache.size > USER_CACHE_MAX) {
        const oldestKey = userCache.keys().next().value;
        if (!oldestKey) break;
        userCache.delete(oldestKey);
      }
    }

    const _rawUserCacheSet = userCache.set.bind(userCache);
    const _rawUserCacheGet = userCache.get.bind(userCache);
    userCache.set = (key, value) => {
      const normalizedKey = idKey(key);
      if (!normalizedKey) return userCache;
      if (userCache.has(normalizedKey)) {
        userCache.delete(normalizedKey);
      }
      _rawUserCacheSet(normalizedKey, { ...(value || {}), id: normalizedKey });
      trimUserCache();
      return userCache;
    };
    userCache.get = (key) => {
      const normalizedKey = idKey(key);
      if (!normalizedKey || !_rawUserCacheGet(normalizedKey)) return undefined;
      const value = _rawUserCacheGet(normalizedKey);
      userCache.delete(normalizedKey);
      _rawUserCacheSet(normalizedKey, value);
      return value;
    };

    async function enrichUserPresence(user) {
      if (!user?.id) return user || null;
      const presenceData = await users.getPresence(user.id).catch(() => null);
      const enriched = {
        ...(user || {}),
        presence: presenceData?.status || user.presence || 'offline',
      };
      userCache.set(enriched.id, enriched);
      return enriched;
    }

    async function getUserCached(userId) {
      if (!userId) return null;
      if (userCache.has(userId)) return userCache.get(userId);
      if (userFetchInFlight.has(userId)) return userFetchInFlight.get(userId);

      const fetchPromise = Promise.all([
        users.get(userId),
        users.getPresence(userId).catch(() => null),
      ])
        .then(([user, presenceData]) => {
          if (!user?.id) return null;
          const enriched = {
            ...user,
            presence: presenceData?.status || user.presence || 'offline',
          };
          userCache.set(enriched.id, enriched);
          return enriched;
        })
        .catch(() => null)
        .finally(() => userFetchInFlight.delete(userId));

      userFetchInFlight.set(userId, fetchPromise);
      return fetchPromise;
    }

    function mergeUserLocally(user, { presence } = {}) {
      const normalizedUserId = idKey(user?.id);
      if (!normalizedUserId) return null;

      const existing = userCache.get(normalizedUserId) || {};
      const merged = {
        ...existing,
        ...user,
        id: normalizedUserId,
      };
      if (presence !== undefined) {
        merged.presence = presence;
      } else if (existing.presence && merged.presence == null) {
        merged.presence = existing.presence;
      }
      userCache.set(normalizedUserId, merged);

      const nextMembers = {};
      for (const [serverId, members] of Object.entries(store.state.members || {})) {
        nextMembers[serverId] = (members || []).map((member) => {
          if (!idsEqual(member.user_id, normalizedUserId)) return member;
          return {
            ...member,
            user: { ...(member.user || {}), ...merged },
          };
        });
      }

      const nextDmList = (store.state.dmList || []).map((dm) => {
        if (!Array.isArray(dm?.participants)) return dm;
        return {
          ...dm,
          participants: dm.participants.map((participant) =>
            idsEqual(participant?.id, normalizedUserId)
              ? { ...(participant || {}), ...merged }
              : participant
          ),
        };
      });

      const nextUser = idsEqual(store.state.user?.id, normalizedUserId)
        ? { ...(store.state.user || {}), ...merged }
        : store.state.user;

      store.set({ user: nextUser, members: nextMembers, dmList: nextDmList });
      renderIconSidebar();
      renderChanSidebar();
      renderMemberSidebar();
      if (msgListEl?.refreshAuthors) {
        msgListEl.refreshAuthors();
      }
      renderTypingBarUi();
      return merged;
    }

    function upsertServerLocally(server) {
      if (!server?.id) return;
      const nextServers = (store.state.servers || []).some((item) => idsEqual(item.id, server.id))
        ? (store.state.servers || []).map((item) => idsEqual(item.id, server.id) ? { ...item, ...server } : item)
        : [{ ...server }, ...(store.state.servers || [])];
      store.set({ servers: nextServers });
      renderIconSidebar();
      renderChanSidebar();
      renderMemberSidebar();
    }

    function removeServerLocally(serverId) {
      const normalized = idKey(serverId);
      if (!normalized) return;
      const joinedVoiceChannelId = idKey(voiceState.joinedChannelId);
      const joinedVoiceServerId = joinedVoiceChannelId ? findServerIdForChannel(joinedVoiceChannelId) : null;
      const nextServers = (store.state.servers || []).filter((item) => !idsEqual(item.id, normalized));
      const nextChannels = { ...(store.state.channels || {}) };
      delete nextChannels[normalized];
      const nextMembers = { ...(store.state.members || {}) };
      delete nextMembers[normalized];
      const nextState = { servers: nextServers, channels: nextChannels, members: nextMembers };

      let shouldClearSelection = idsEqual(store.state.activeServerId, normalized);
      if (!shouldClearSelection && idKey(store.state.activeChannelId)) {
        const channelServerId = findServerIdForChannel(store.state.activeChannelId);
        shouldClearSelection = idsEqual(channelServerId, normalized);
      }

      if (shouldClearSelection) {
        nextState.activeServerId = null;
        nextState.activeChannelId = null;
        nextState.activeDmId = null;
      }

      store.set(nextState);
      if (joinedVoiceServerId && idsEqual(joinedVoiceServerId, normalized)) {
        removeVoiceParticipantsEntry(joinedVoiceChannelId);
        void leaveVoiceChannel(false);
      }
      renderIconSidebar();
      renderChanSidebar();
      renderMemberSidebar();
      renderChatMain();
    }

    function upsertChannelLocally(channel) {
      if (!channel?.id) return;
      if (String(channel.type || '').toLowerCase() === 'dm') {
        upsertDmInState(channel);
        return;
      }

      const serverId = idKey(channel.server_id);
      if (!serverId) return;
      const current = store.state.channels || {};
      const nextChannels = { ...current };
      const list = nextChannels[serverId] || [];
      nextChannels[serverId] = list.some((item) => idsEqual(item.id, channel.id))
        ? list.map((item) => idsEqual(item.id, channel.id) ? { ...item, ...channel } : item)
        : [{ ...channel }, ...list];
      store.set({ channels: nextChannels });
      syncChannelSubscriptions();
      if (idsEqual(store.state.activeServerId, serverId)) {
        renderChanSidebar();
      }
      if (idsEqual(store.state.activeChannelId, channel.id)) {
        renderChatMain();
      }
    }

    function removeChannelLocally(channelId) {
      const normalized = idKey(channelId);
      if (!normalized) return;

      const nextChannels = {};
      for (const [serverId, channels] of Object.entries(store.state.channels || {})) {
        nextChannels[serverId] = (channels || []).filter((item) => !idsEqual(item.id, normalized));
      }

      const nextDmList = (store.state.dmList || []).filter((item) => !idsEqual(item.id, normalized));
      const nextState = { channels: nextChannels, dmList: nextDmList };

      const activeChannelMatches = idsEqual(store.state.activeChannelId, normalized);
      const activeDmMatches = idsEqual(store.state.activeDmId, normalized);
      if (activeChannelMatches || activeDmMatches) {
        nextState.activeChannelId = null;
        nextState.activeDmId = null;
      }

      store.set(nextState);
      syncChannelSubscriptions();
      if (idsEqual(voiceState.joinedChannelId, normalized)) {
        removeVoiceParticipantsEntry(normalized);
        void leaveVoiceChannel(false);
      }
      renderIconSidebar();
      renderChanSidebar();
      renderMemberSidebar();
      renderChatMain();
    }

    function upsertMemberLocally(member, user = null, server = null) {
      if (!member?.server_id || !member?.user_id) return;
      if (user?.id) mergeUserLocally(user);

      const serverId = idKey(member.server_id);
      const currentMembers = store.state.members || {};
      const list = currentMembers[serverId] || [];
      const nextMembers = {
        ...currentMembers,
        [serverId]: list.some((item) => idsEqual(item.user_id, member.user_id))
          ? list.map((item) => idsEqual(item.user_id, member.user_id) ? { ...item, ...member, user: { ...(item.user || {}), ...(user || item.user || {}) } } : item)
          : [{ ...member, user: user ? { ...user } : null }, ...list],
      };

      const nextState = { members: nextMembers };
      if (server?.id && idsEqual(store.state.user?.id, member.user_id)) {
        const nextServers = (store.state.servers || []).some((item) => idsEqual(item.id, server.id))
          ? (store.state.servers || []).map((item) => idsEqual(item.id, server.id) ? { ...item, ...server } : item)
          : [{ ...server }, ...(store.state.servers || [])];
        nextState.servers = nextServers;
      }
      store.set(nextState);
      renderIconSidebar();
      renderChanSidebar();
      renderMemberSidebar();
    }

    function removeMemberLocally(serverId, userId) {
      const normalizedServerId = idKey(serverId);
      const normalizedUserId = idKey(userId);
      if (!normalizedServerId || !normalizedUserId) return;

      const currentMembers = store.state.members || {};
      const nextMembers = {
        ...currentMembers,
        [normalizedServerId]: (currentMembers[normalizedServerId] || []).filter((item) => !idsEqual(item.user_id, normalizedUserId)),
      };

      store.set({ members: nextMembers });
      renderMemberSidebar();
    }

    function removeUserLocally(userId) {
      const normalized = idKey(userId);
      if (!normalized) return;

      userCache.delete(normalized);

      const nextMembers = {};
      for (const [serverId, members] of Object.entries(store.state.members || {})) {
        nextMembers[serverId] = (members || []).filter((member) => !idsEqual(member.user_id, normalized));
      }

      const nextDmList = (store.state.dmList || []).map((dm) => {
        if (!Array.isArray(dm?.participants)) return dm;
        return {
          ...dm,
          participants: dm.participants.filter((participant) => !idsEqual(participant?.id, normalized)),
        };
      }).filter((dm) => !Array.isArray(dm?.participants) || dm.participants.length >= 2);

      const nextUser = idsEqual(store.state.user?.id, normalized) ? null : store.state.user;
      store.set({ user: nextUser, members: nextMembers, dmList: nextDmList });
      renderIconSidebar();
      renderChanSidebar();
      renderMemberSidebar();
      if (msgListEl?.refreshAuthors) {
        msgListEl.refreshAuthors();
      }
    }

    function getChannelFromState(channelId) {
      const normalized = idKey(channelId);
      if (!normalized) return null;
      for (const channels of Object.values(store.state.channels || {})) {
        const found = (channels || []).find((channel) => idsEqual(channel.id, normalized));
        if (found) return found;
      }
      for (const dm of store.state.dmList || []) {
        if (idsEqual(dm?.id, normalized)) return dm;
      }
      return null;
    }

    function getServerIdForChannel(channelId) {
      const channel = getChannelFromState(channelId);
      return idKey(channel?.server_id) || null;
    }

    function getCurrentMemberRole(serverId) {
      const normalized = idKey(serverId);
      if (!normalized) return null;
      const members = store.state.members || {};
      const current = (members[normalized] || []).find((member) => idsEqual(member.user_id, store.state.user?.id));
      return current?.role || null;
    }

    function canModerateServer(serverId) {
      const role = String(getCurrentMemberRole(serverId) || '').toLowerCase();
      return ['owner', 'admin', 'moderator'].includes(role);
    }

    function canManageWebhooks(serverId) {
      const role = String(getCurrentMemberRole(serverId) || '').toLowerCase();
      return ['owner', 'admin'].includes(role);
    }

    function canManageRoles(serverId) {
      const role = String(getCurrentMemberRole(serverId) || '').toLowerCase();
      return role === 'owner';
    }

    function communityToolsEnabled() {
      return featureFlagEnabled('community_tools');
    }

    function directoryRecommendationsEnabled() {
      return featureFlagEnabled('directory_recommendations');
    }

    // ─── Servers ──────────────────────────────────────────────────────────────────
    const servers = {
      list: () => req('GET', '/servers'),
      directory: ({ recommended = false } = {}) => req('GET', `/servers/directory${recommended ? '?recommended=true' : ''}`),
      create: (name, icon = null, description = null, directoryOptIn = false) =>
        req('POST', '/servers', { name, icon, description, directory_opt_in: directoryOptIn }),
      get: (id) => req('GET', `/servers/${id}`),
      update: (id, body) => req('PATCH', `/servers/${id}`, body),
      delete: (id) => req('DELETE', `/servers/${id}`),
      join: (id) => req('POST', `/servers/${id}/join`),
      createInvite: (id) => req('POST', `/servers/${id}/invites`),
      lookupInvite: (code) => req('GET', `/servers/invites/${encodeURIComponent(code)}`),
      joinByInvite: (code) => req('POST', `/servers/invites/${encodeURIComponent(code)}/join`),
      leave: (id) => req('POST', `/servers/${id}/leave`),
      members: (id) => req('GET', `/servers/${id}/members`),
      setRole: (serverId, userId, role) =>
        req('PATCH', `/servers/${serverId}/members/${userId}?role=${role}`),
    };

    // ─── Channels ─────────────────────────────────────────────────────────────────
    const channels = {
      list: (serverId) => req('GET', `/channels/server/${serverId}`),
      create: (serverId, body) => req('POST', `/channels/server/${serverId}`, body),
      get: (id) => req('GET', `/channels/${id}`),
      updateReadState: (id, lastReadMessageId = null) => req('PUT', `/channels/${id}/read-state`, { last_read_message_id: lastReadMessageId }),
      update: (id, body) => req('PATCH', `/channels/${id}`, body),
      delete: (id) => req('DELETE', `/channels/${id}`),
    };

    // ─── Messages ─────────────────────────────────────────────────────────────────
    const messages = {
      list: (channelId, cursor, limit = 50) => {
        let q = `?limit=${limit}`;
        if (cursor) q += `&cursor=${cursor}`;
        return req('GET', `/messages/channels/${channelId}${q}`);
      },
      search: (params = {}) => {
        const query = new URLSearchParams();
        if (params.q) query.set('q', params.q);
        if (params.channel_id) query.set('channel_id', String(params.channel_id));
        if (params.server_id) query.set('server_id', String(params.server_id));
        if (params.author_id) query.set('author_id', String(params.author_id));
        if (params.before) query.set('before', String(params.before));
        if (params.after) query.set('after', String(params.after));
        if (params.has_attachments != null) query.set('has_attachments', params.has_attachments ? 'true' : 'false');
        if (params.has_reactions != null) query.set('has_reactions', params.has_reactions ? 'true' : 'false');
        if (params.limit) query.set('limit', String(params.limit));
        return req('GET', `/messages/search?${query.toString()}`);
      },
      send: (channelId, content, attachments = [], replyToId = null, isNsfw = false) =>
        req('POST', `/messages/channels/${channelId}`, { content, attachments, reply_to_id: replyToId, is_nsfw: !!isNsfw }),
      edit: (id, content) => req('PATCH', `/messages/${id}`, { content }),
      delete: (id) => req('DELETE', `/messages/${id}`),
      pins: (channelId) => req('GET', `/messages/pins/channels/${channelId}`),
      pin: (id) => req('PUT', `/messages/${id}/pin`),
      unpin: (id) => req('DELETE', `/messages/${id}/pin`),
      bookmarks: () => req('GET', '/messages/bookmarks'),
      bookmark: (id) => req('PUT', `/messages/${id}/bookmark`),
      unbookmark: (id) => req('DELETE', `/messages/${id}/bookmark`),
      addReaction: (id, emoji) => req('PUT', `/messages/${id}/reactions`, { emoji }),
      removeReaction: (id, emoji) => req('DELETE', `/messages/${id}/reactions?emoji=${encodeURIComponent(emoji)}`),
    };
    const msgApi = messages;
    const MsgApi = messages;

    // ─── DMs ──────────────────────────────────────────────────────────────────────
    const dms = {
      list: () => req('GET', '/dms'),
      create: (userId) => req('POST', '/dms', { recipient_id: userId }),
      get: (channelId) => req('GET', `/dms/${channelId}`),
      delete: (channelId) => req('DELETE', `/dms/${channelId}`),
    };

    // ─── Uploads ──────────────────────────────────────────────────────────────────
    const uploads = {
      upload: (file) => {
        const form = new FormData();
        form.append('file', file);
        return req('POST', '/uploads', form, { noContentType: true });
      },
    };

    // ─── Community Tools ────────────────────────────────────────────────────────
    const community = {
      activity: (serverId) => req('GET', `/servers/${serverId}/activity`),
      webhooks: {
        list: (serverId) => req('GET', `/servers/${serverId}/webhooks`),
        create: (serverId, body) => req('POST', `/servers/${serverId}/webhooks`, body),
        delete: (webhookId) => req('DELETE', `/webhooks/${webhookId}`),
        deliveries: (serverId, webhookId) => req('GET', `/servers/${serverId}/webhooks/${webhookId}/deliveries`),
        invoke: (webhookId, token, body) => req('POST', `/webhooks/${webhookId}/${encodeURIComponent(token)}`, body),
      },
      workspace: {
        get: (channelId, visibility = 'public') => req('GET', `/channels/${channelId}/workspace?visibility=${encodeURIComponent(visibility || 'public')}`),
        update: (channelId, body) => req('PATCH', `/channels/${channelId}/workspace`, body),
      },
    };

    // ─── WebSocket ────────────────────────────────────────────────────────────────
    class WyvernSocket {
      constructor(onEvent) {
        this.onEvent = onEvent;
        this.ws = null;
        this.reconnectDelay = 1000;
        this._pingInterval = null;
        this._manualClose = false;
      }

      connect() {
        if (!token.access) return;
        this._manualClose = false;
        const wsOrigin = BACKEND_URL_FALLBACK;
        const wsBase = wsOrigin
          ? wsOrigin.replace(/^http/, 'ws')
          : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
        const url = `${wsBase}${websocketPath()}?token=${token.access}`;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.reconnectDelay = 1000;
          this._pingInterval = setInterval(() => this.send({ action: 'ping' }), 30000);
          this.onEvent({ type: 'connected' });
        };

        this.ws.onerror = () => {
          playSoundEffect('error');
          this.onEvent({ type: 'error' });
        };

        this.ws.onmessage = (e) => {
          try { this.onEvent(JSON.parse(e.data)); } catch { }
        };

        this.ws.onclose = () => {
          clearInterval(this._pingInterval);
          this.onEvent({ type: 'disconnected' });
          if (!this._manualClose) {
            setTimeout(() => this.connect(), this.reconnectDelay);
          }
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        };
      }

      send(obj) {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(obj));
        }
      }

      subscribe(channelIds) { this.send({ action: 'subscribe', channel_ids: channelIds }); }
      unsubscribe(channelIds) { this.send({ action: 'unsubscribe', channel_ids: channelIds }); }

      disconnect() {
        clearInterval(this._pingInterval);
        this._manualClose = true;
        this.ws?.close();
      }
    }


    // Minimal reactive state store
    class Store {
      constructor(initial) {
        this._state = { ...initial };
        this._listeners = new Set();
      }

      get state() { return this._state; }

      set(partial) {
        this._state = { ...this._state, ...partial };
        this._listeners.forEach(fn => fn(this._state));
      }

      subscribe(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
      }
    }

    const store = new Store({
      // auth
      user: null,
      isAuthed: false,

      // navigation
      view: 'auth', // 'auth' | 'app' | 'edge-shell' | 'legal'
      viewNonce: 0,
      activeServerId: null,
      activeChannelId: null,
      activeDmId: null,
      sidebarMode: 'servers', // 'servers' | 'dms' | 'community'
      mobileSidebarOpen: false,
      communityHubTab: 'discover',
      communityHubWorkspaceTargetId: null,
      communityHubWorkspaceTargetKind: 'server',
      communityHubWorkspaceVisibility: 'public',
      communityHubPinsTargetId: null,
      communityHubPinsTargetKind: 'server',

      // data
      servers: [],
      channels: {},       // serverId -> []
      messages: {},       // channelId -> []
      members: {},        // serverId -> []
      dmList: [],
      voiceParticipants: {}, // channelId -> [userId]
      readStates: {},      // channelId -> { last_read_message_id, last_read_at, updated_at }
      latestMessageByChannel: {}, // channelId -> { id, author_id, created_at }

      // ui
      wsConnected: false,
      loadingMessages: false,
      initialSidebarLoading: false,
      sendingMessage: false,
      activeVoiceChannelId: null,
      memberSidebarOpen: false,
      typingUsers: {},    // channelId -> [userId]
      messageInput: '',
      error: null,
      toast: null,
    });
    const voiceState = {
      joinedChannelId: null,
      localStream: null,
      peers: new Map(),
      peerMeta: new Map(),
      remoteAudioEls: new Map(),
      audioContext: null,
      speakingMeters: new Map(),
      speakingUsers: new Set(),
      speakingPollTimer: null,
      muted: false,
      statusPollTimer: null,
    };
    const socketSubscriptions = new Set();

    function hydrateReadStates(states) {
      const next = {};
      for (const state of states || []) {
        const channelId = idKey(state?.channel_id);
        if (!channelId) continue;
        next[channelId] = {
          channel_id: channelId,
          last_read_message_id: idKey(state?.last_read_message_id) || null,
          last_read_at: state?.last_read_at || null,
          updated_at: state?.updated_at || null,
        };
      }
      return next;
    }

    function rememberLatestMessage(message) {
      const channelId = idKey(message?.channel_id);
      const messageId = idKey(message?.id);
      if (!channelId || !messageId) return;
      const current = store.state.latestMessageByChannel || {};
      const existing = current[channelId];
      if (existing && existing.id === messageId) return;
      store.set({
        latestMessageByChannel: {
          ...current,
          [channelId]: {
            id: messageId,
            author_id: idKey(message?.author_id) || null,
            created_at: message?.created_at || null,
          },
        },
      });
    }

    async function markChannelRead(channelId, lastReadMessageId = null) {
      const normalizedChannelId = idKey(channelId);
      if (!normalizedChannelId) return;
      const nextMessageId = idKey(lastReadMessageId || store.state.latestMessageByChannel?.[normalizedChannelId]?.id) || null;
      const existing = store.state.readStates?.[normalizedChannelId];
      if (existing && idsEqual(existing.last_read_message_id, nextMessageId)) return;
      const optimistic = {
        ...(existing || {}),
        channel_id: normalizedChannelId,
        last_read_message_id: nextMessageId,
        last_read_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.set({
        readStates: {
          ...(store.state.readStates || {}),
          [normalizedChannelId]: optimistic,
        },
      });
      try {
        const saved = await channels.updateReadState(normalizedChannelId, nextMessageId);
        store.set({
          readStates: {
            ...(store.state.readStates || {}),
            [normalizedChannelId]: {
              channel_id: normalizedChannelId,
              last_read_message_id: idKey(saved?.last_read_message_id) || null,
              last_read_at: saved?.last_read_at || optimistic.last_read_at,
              updated_at: saved?.updated_at || optimistic.updated_at,
            },
          },
        });
      } catch { }
    }

    function channelHasUnread(channelId) {
      const normalizedChannelId = idKey(channelId);
      if (!normalizedChannelId) return false;
      const latest = store.state.latestMessageByChannel?.[normalizedChannelId];
      if (!latest?.id) return false;
      if (idsEqual(latest.author_id, store.state.user?.id)) return false;
      const readState = store.state.readStates?.[normalizedChannelId];
      return !idsEqual(readState?.last_read_message_id, latest.id);
    }

    const PRESENCE_OPTIONS = [
      { value: 'online', label: 'Online' },
      { value: 'idle', label: 'Idle' },
      { value: 'dnd', label: 'Do Not Disturb' },
    ];

    function allSubscribableChannelIds() {
      const serverChans = Object.values(store.state.channels || {}).flat();
      const dmsKnown = store.state.dmList || [];
      return [...new Set([...serverChans, ...dmsKnown].map((item) => idKey(item?.id)).filter(Boolean))];
    }

    function syncChannelSubscriptions() {
      if (!socket || !store.state.wsConnected) return;
      const wanted = new Set(allSubscribableChannelIds());
      const toSubscribe = [...wanted].filter((channelId) => !socketSubscriptions.has(channelId));
      const toUnsubscribe = [...socketSubscriptions].filter((channelId) => !wanted.has(channelId));
      if (toSubscribe.length) {
        socket.subscribe(toSubscribe);
        toSubscribe.forEach((channelId) => socketSubscriptions.add(channelId));
      }
      if (toUnsubscribe.length) {
        socket.unsubscribe(toUnsubscribe);
        toUnsubscribe.forEach((channelId) => socketSubscriptions.delete(channelId));
      }
    }

    function setTypingUsersForChannel(channelId, userIds) {
      const normalizedChannelId = idKey(channelId);
      if (!normalizedChannelId) return;
      const normalizedUsers = [...new Set((userIds || []).map(idKey).filter(Boolean))];
      store.set({
        typingUsers: {
          ...(store.state.typingUsers || {}),
          [normalizedChannelId]: normalizedUsers,
        },
      });
    }

    function renderTypingBarUi() {
      const bar = document.querySelector('.typing-bar');
      if (!bar) return;
      const activeChannelId = idKey(store.state.activeChannelId);
      const activeTypers = (store.state.typingUsers?.[activeChannelId] || [])
        .filter((userId) => !idsEqual(userId, store.state.user?.id))
        .map((userId) => displayName(userCache.get(userId) || { username: 'Someone' }));
      bar.innerHTML = '';
      bar.hidden = !activeTypers.length;
      if (!activeTypers.length) return;
      const lead = activeTypers.slice(0, 2).join(', ');
      const label = activeTypers.length === 1
        ? `${lead} is typing...`
        : (activeTypers.length === 2 ? `${lead} are typing...` : `${lead} and others are typing...`);
      bar.append(
        el('span', { class: 'typing-dots', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')),
        el('span', { class: 'typing-copy' }, label),
      );
    }

    const GIPHY_FALLBACK_LIBRARY = [
      { title: 'Excited', tags: ['hype', 'excited', 'celebrate'], url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif' },
      { title: 'Mind Blown', tags: ['wow', 'mind blown', 'shock'], url: 'https://media.giphy.com/media/3oEduOnl5IHM5NRodO/giphy.gif' },
      { title: 'Dragon Fire', tags: ['dragon', 'fire', 'wyvern'], url: 'https://media.giphy.com/media/l41YvpiA9uMWw5AMU/giphy.gif' },
      { title: 'Thumbs Up', tags: ['yes', 'ok', 'approve'], url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },
      { title: 'Applause', tags: ['clap', 'applause', 'nice'], url: 'https://media.giphy.com/media/5xaOcLGvzHxDKjufnLW/giphy.gif' },
      { title: 'Laughing', tags: ['lol', 'laugh', 'funny'], url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif' },
      { title: 'Typing', tags: ['typing', 'working', 'fast'], url: 'https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif' },
      { title: 'Victory', tags: ['win', 'victory', 'success'], url: 'https://media.giphy.com/media/8Iv5lqKwKsZ2g/giphy.gif' },
    ];

    function giphySearchConfig() {
      const apiKey = String(runtimeConfig?.giphy_api_key || '').trim();
      const rating = String(runtimeConfig?.giphy_rating || 'g').trim() || 'g';
      const limit = Math.min(50, Math.max(1, Number(runtimeConfig?.giphy_limit || 24) || 24));
      return { apiKey, rating, limit };
    }

    function giphyPreviewUrl(item) {
      const images = item?.images || {};
      return (
        images.fixed_width_small?.url ||
        images.fixed_height_small?.url ||
        images.fixed_width?.url ||
        images.fixed_height?.url ||
        images.original?.url ||
        item?.url ||
        ''
      );
    }

    function giphyFallbackResults(query = '') {
      const normalized = String(query || '').trim().toLowerCase();
      return GIPHY_FALLBACK_LIBRARY.filter((item) => {
        const haystack = `${item.title} ${(item.tags || []).join(' ')}`.toLowerCase();
        return !normalized || haystack.includes(normalized);
      }).map((item) => ({
        title: item.title,
        url: item.url,
        source: 'fallback',
      }));
    }

    async function fetchGiphyResults(query = '') {
      const { apiKey, rating, limit } = giphySearchConfig();
      if (!apiKey) return { items: giphyFallbackResults(query), source: 'fallback', disabled: true };

      const endpoint = new URL(query ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
      endpoint.searchParams.set('api_key', apiKey);
      endpoint.searchParams.set('limit', String(limit));
      endpoint.searchParams.set('rating', rating);
      endpoint.searchParams.set('bundle', 'messaging_non_clips');
      endpoint.searchParams.set('remove_low_contrast', 'true');
      endpoint.searchParams.set('lang', (navigator.language || 'en').split('-')[0] || 'en');
      if (query) endpoint.searchParams.set('q', query);

      const response = await fetch(endpoint.toString(), { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`GIPHY request failed with status ${response.status}`);
      }

      const payload = await response.json().catch(() => ({}));
      const items = Array.isArray(payload?.data) ? payload.data : [];
      return {
        items: items
          .map((item) => ({
            title: item?.title || item?.alt_text || item?.slug || `GIF ${item?.id || ''}`.trim() || 'GIF',
            url: giphyPreviewUrl(item),
            source: 'giphy',
          }))
          .filter((item) => item.url),
        source: 'giphy',
        disabled: false,
      };
    }

    const SOUND_EFFECTS = {
      connect: '/static/sounds/rtc_connect.wav',
      disconnect: '/static/sounds/rtc_disconnect.wav',
      error: '/static/sounds/rtc_error.wav',
      ping: '/static/sounds/notification_ping.wav',
    };
    const soundEffectPool = new Map();
    let soundEffectsPrimed = false;

    function getSoundEffect(effectName) {
      const url = SOUND_EFFECTS[effectName];
      if (!url) return null;
      if (!soundEffectPool.has(effectName)) {
        const audio = new Audio(url);
        audio.preload = 'auto';
        soundEffectPool.set(effectName, audio);
      }
      return soundEffectPool.get(effectName);
    }

    function primeSoundEffects() {
      if (soundEffectsPrimed) return;
      soundEffectsPrimed = true;
      for (const effectName of Object.keys(SOUND_EFFECTS)) {
        const audio = getSoundEffect(effectName);
        if (!audio) continue;
        try {
          const clone = audio.cloneNode();
          clone.volume = 0;
          clone.play().then(() => {
            clone.pause();
            clone.currentTime = 0;
          }).catch(() => { });
        } catch { }
      }
    }

    function playSoundEffect(effectName) {
      const audio = getSoundEffect(effectName);
      if (!audio) return;
      try {
        const clone = audio.cloneNode();
        clone.volume = 1;
        clone.currentTime = 0;
        void clone.play().catch(() => { });
      } catch { }
    }

    window.addEventListener('pointerdown', primeSoundEffects, { once: true, capture: true });
    window.addEventListener('keydown', primeSoundEffects, { once: true, capture: true });
    window.addEventListener('touchstart', primeSoundEffects, { once: true, capture: true });

    function toast(message, type = 'info', duration = 3000) {
      if (type === 'error') playSoundEffect('error');
      store.set({ toast: { message, type, id: Date.now() } });
      setTimeout(() => store.set({ toast: null }), duration);
    }

    function rerenderCurrentView() {
      store.set({ viewNonce: Date.now() });
    }

    let pushStackEl = null;

    function ensurePushStack() {
      if (pushStackEl && document.body.contains(pushStackEl)) return pushStackEl;
      pushStackEl = el('div', { class: 'push-stack' });
      document.body.appendChild(pushStackEl);
      return pushStackEl;
    }

    function pushNotification({ title, body, meta = '', duration = 15000, onClick = null }) {
      const stack = ensurePushStack();
      const note = el('div', { class: 'push-note' },
        el('div', { class: 'push-title' }, title || 'Notification'),
        el('div', { class: 'push-body' }, body || ''),
        meta ? el('div', { class: 'push-meta' }, meta) : null
      );

      let removed = false;
      const removeNote = () => {
        if (removed) return;
        removed = true;
        note.classList.add('fade-out');
        setTimeout(() => note.remove(), 170);
      };

      note.addEventListener('click', async () => {
        if (typeof onClick === 'function') {
          try {
            await onClick();
          } catch { }
        }
        removeNote();
      });

      stack.appendChild(note);
      setTimeout(removeNote, Math.max(1000, duration));
      return removeNote;
    }


    // ─── DOM helpers ─────────────────────────────────────────────────────────────
    function appendTrustedHtml(target, html) {
      const template = document.createElement('template');
      template.innerHTML = String(html || '');
      target.appendChild(template.content.cloneNode(true));
      return target;
    }

    function trustedHtmlEl(tag, attrs = {}, html = '') {
      const node = el(tag, attrs);
      appendTrustedHtml(node, html);
      return node;
    }

    function el(tag, attrs = {}, ...children) {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'unsafeHtml') appendTrustedHtml(e, v);
        else if (k === 'value' && 'value' in e) e.value = v ?? '';
        else if (typeof v === 'boolean') {
          if (k in e) e[k] = v;
          if (v) e.setAttribute(k, '');
          else e.removeAttribute(k);
        } else e.setAttribute(k, v);
      }
      for (const c of children) {
        if (c == null) continue;
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
      }
      return e;
    }

    const HERO_ICON_PATHS = {
      plus: '<path d="M12 4.5v15m7.5-7.5h-15" />',
      hashtag: '<path d="M5.25 8.25h13.5M5.25 15.75h13.5M8.25 3.75 6.75 20.25M17.25 3.75 15.75 20.25" />',
      paperClip: '<path d="m18.375 12.75-6.34 6.34a4.5 4.5 0 1 1-6.364-6.364l8.47-8.47a3 3 0 1 1 4.243 4.243l-8.485 8.485a1.5 1.5 0 1 1-2.121-2.122l6.364-6.364" />',
      paperAirplane: '<path d="M6 12 3.27 3.64a.75.75 0 0 1 .98-.92l16.5 6.75a.75.75 0 0 1 0 1.39l-16.5 6.75a.75.75 0 0 1-.98-.92L6 12Zm0 0h7.5" />',
      arrowUp: '<path d="m4.5 12.75 7.5-7.5 7.5 7.5" /><path d="M12 5.25v13.5" />',
      faceSmile: '<path d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M9.75 9.75h.008v.008H9.75V9.75Zm4.5 0h.008v.008h-.008V9.75Z" /><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
      pencilSquare: '<path d="M16.862 4.487a2.25 2.25 0 1 1 3.182 3.182L8.25 19.463 3 21l1.537-5.25L16.862 4.487Z" /><path d="M19.5 13.5V21H3V4.5h7.5" />',
      trash: '<path d="M14.74 9 14.394 18m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0V4.875c0-1.243-1.007-2.25-2.25-2.25h-3c-1.243 0-2.25 1.007-2.25 2.25V5.25m7.5 0h-7.5" />',
      arrowRightOnRectangle: '<path d="M8.25 7.5V6A2.25 2.25 0 0 1 10.5 3.75h8.25A2.25 2.25 0 0 1 21 6v12a2.25 2.25 0 0 1-2.25 2.25H10.5A2.25 2.25 0 0 1 8.25 18v-1.5" /><path d="M15 12H3.75m0 0 3.75-3.75M3.75 12l3.75 3.75" />',
      arrowLeftOnRectangle: '<path d="M15.75 7.5V6A2.25 2.25 0 0 0 13.5 3.75H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25h8.25A2.25 2.25 0 0 0 15.75 18v-1.5" /><path d="M9 12h11.25m0 0-3.75-3.75M20.25 12l-3.75 3.75" />',
      arrowDown: '<path d="m19.5 12.75-7.5 7.5-7.5-7.5" /><path d="M12 3.75v16.5" />',
      link: '<path d="M13.19 8.688a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757a4.5 4.5 0 0 1-6.364 0m1.757-7.07a4.5 4.5 0 0 0-6.364 0L5.07 11.496a4.5 4.5 0 0 0 0 6.364 4.5 4.5 0 0 0 6.364 0l1.757-1.757" />',
      cog: '<path d="M10.5 6h3m-7.5 6h12m-9 6h6" /><path d="M18 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM9 12a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm9 6a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />',
      key: '<path d="M21 2.25a4.5 4.5 0 0 0-4.5 4.5c0 .59.114 1.153.319 1.669L9 16.238V18.75H6.75V21H4.5v-2.25H2.25v-2.25l7.819-7.819A4.5 4.5 0 1 0 21 2.25Z" /><path d="M16.5 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />',
      bookmark: '<path d="M6.75 3.75h10.5a.75.75 0 0 1 .75.75v15.75l-6-3.75-6 3.75V4.5a.75.75 0 0 1 .75-.75Z" />',
      pin: '<path d="M15.75 3.75 20.25 8.25l-3 3-.75 4.5-2.25-.75-4.5 4.5" /><path d="M8.25 6 18 15.75" />',
      userGroup: '<path d="M18 18.72a8.94 8.94 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198v-.75c0-1.665-.87-3.13-2.182-3.957m0 0A5.97 5.97 0 0 0 12 13.5a5.97 5.97 0 0 0-3.818 1.372m7.636 0A5.97 5.97 0 0 1 12 15.75a5.97 5.97 0 0 1-3.818-1.378m0 0a3 3 0 0 0-4.681 2.72A8.94 8.94 0 0 0 6 18.72m9.818-9.348a3.75 3.75 0 1 0-7.636 0 3.75 3.75 0 0 0 7.636 0Zm3.182-1.372a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />',
      squares: '<path d="M3.75 3.75h6.75v6.75H3.75V3.75Zm9.75 0h6.75v6.75H13.5V3.75Zm0 9.75h6.75v6.75H13.5V13.5Zm-9.75 0h6.75v6.75H3.75V13.5Z" />',
      speakerWave: '<path d="M19.114 8.181a6 6 0 0 1 0 7.638M15.75 9.75a3.75 3.75 0 0 1 0 4.5" /><path d="M11.25 5.25 7.5 8.25H4.5a.75.75 0 0 0-.75.75v6a.75.75 0 0 0 .75.75h3l3.75 3V5.25Z" />',
      clock: '<path d="M12 6v6l4 2" /><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />',
      chatBubble: '<path d="M7.5 8.25h5.25m-5.25 3h8.25m-8.25 3h3.75" /><path d="M6.75 21a8.966 8.966 0 0 1-4.122-.994.75.75 0 0 1-.378-.663V6.75A2.25 2.25 0 0 1 4.5 4.5h15A2.25 2.25 0 0 1 21.75 6.75v8.25a2.25 2.25 0 0 1-2.25 2.25H9.31l-2.934 3.26A.75.75 0 0 1 6.75 21Z" />',
      phone: '<path d="M2.25 4.5A2.25 2.25 0 0 1 4.5 2.25h1.372c.52 0 .973.353 1.103.856l.811 3.162a1.125 1.125 0 0 1-.417 1.164l-1.293.97a11.036 11.036 0 0 0 5.52 5.52l.97-1.293a1.125 1.125 0 0 1 1.164-.417l3.162.81c.503.13.856.584.856 1.104V19.5a2.25 2.25 0 0 1-2.25 2.25h-1.5C7.425 21.75 2.25 16.575 2.25 10.5V4.5Z" />',
      phoneXMark: '<path d="M15.75 9.75 18 12m0 0 2.25 2.25M18 12l2.25-2.25M18 12l-2.25 2.25" /><path d="M2.25 4.5A2.25 2.25 0 0 1 4.5 2.25h1.372c.52 0 .973.353 1.103.856l.811 3.162a1.125 1.125 0 0 1-.417 1.164l-1.293.97a11.036 11.036 0 0 0 5.52 5.52l.97-1.293a1.125 1.125 0 0 1 1.164-.417l1.518.39M17.25 19.5a2.25 2.25 0 0 1-2.25 2.25h-1.5C7.425 21.75 2.25 16.575 2.25 10.5V4.5" />',
      magnifyingGlass: '<path d="m21 21-4.35-4.35m0 0A7.5 7.5 0 1 0 6 6a7.5 7.5 0 0 0 10.65 10.65Z" />',
      xMark: '<path d="M6 18 18 6M6 6l12 12" />',
      arrowUturnLeft: '<path d="M9 14.25H5.25m0 0L9 18m-3.75-3.75L9 10.5" /><path d="M5.25 14.25h7.875a4.875 4.875 0 1 0 0-9.75H9.75" />'
    };

    function heroIcon(name, { size = 18, className = '', solid = false } = {}) {
      const paths = HERO_ICON_PATHS[name];
      const classes = ['ui-icon'];
      if (solid) classes.push('is-solid');
      if (className) classes.push(className);

      const iconEl = el('span', {
        class: classes.join(' '),
        unsafeHtml: `<svg viewBox="0 0 24 24" aria-hidden="true">${paths || ''}</svg>`,
      });
      iconEl.style.width = `${size}px`;
      iconEl.style.height = `${size}px`;
      return iconEl;
    }

    function setIconCount(button, iconName, count = 0, size = 18) {
      button.replaceChildren(
        el(
          'span',
          { class: count ? 'icon-with-count' : '' },
          heroIcon(iconName, { size }),
          count ? el('span', { class: 'icon-count' }, String(count)) : null,
        ),
      );
    }

    function qs(sel, parent = document) { return parent.querySelector(sel); }

    function mount(parent, component) {
      parent.innerHTML = '';
      parent.appendChild(component);
    }

    // ─── Avatar helpers ───────────────────────────────────────────────────────────
    const COLORS = [
      '#00c8ff', '#8B2252', '#1a5c3a', '#4a3080', '#5c3a00',
      '#1a3a5c', '#5c2020', '#2a5c4a', '#4a4a00', '#5c3a5c'
    ];

    function avatarColor(str = '') {
      let h = 0;
      for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return COLORS[h % COLORS.length];
    }

    function initials(name = '') {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return (name.slice(0, 2)).toUpperCase();
    }

    function displayName(user) {
      if (!user) return 'Unknown';
      return user.display_name || user.username || 'Unknown';
    }

    function presenceLabel(status = 'online') {
      const found = PRESENCE_OPTIONS.find((item) => item.value === status);
      return found?.label || 'Offline';
    }

    function usernameTag(user) {
      if (!user) return '#0000';
      const uname = user.username || 'user';
      const disc = user.discriminator || '0000';
      return `${uname}#${disc}`;
    }

    function avatarEl(name, cls = '', size = 38, avatarUrl = null) {
      const d = el('div', { class: cls });
      d.style.background = avatarColor(name);
      d.style.width = size + 'px';
      d.style.height = size + 'px';
      d.style.borderRadius = '50%';
      d.style.display = 'flex';
      d.style.alignItems = 'center';
      d.style.justifyContent = 'center';
      d.style.fontSize = Math.floor(size * 0.34) + 'px';
      d.style.fontWeight = '700';
      d.style.flexShrink = '0';

      const safeAvatarUrl = normalizeDisplayUrl(avatarUrl);
      if (safeAvatarUrl) {
        const img = el('img', { class: 'avatar-img', src: safeAvatarUrl, alt: name || 'avatar' });
        img.addEventListener('error', () => {
          img.remove();
          d.textContent = initials(name || '?');
        });
        d.appendChild(img);
      } else {
        d.textContent = initials(name || '?');
      }
      return d;
    }

    // ─── Date helpers ─────────────────────────────────────────────────────────────
    function fmtTime(iso) {
      const d = new Date(iso);
      const now = new Date();
      const sameCalendarDay = d.toDateString() === now.toDateString();
      if (sameCalendarDay) {
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      }
      const options = d.getFullYear() === now.getFullYear()
        ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
        : { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
      return d.toLocaleString('en-US', options);
    }

    function fmtDate(iso) {
      const d = new Date(iso);
      const now = new Date();
      if (d.toDateString() === now.toDateString()) return 'Today';
      return d.toLocaleDateString('en-US', d.getFullYear() === now.getFullYear()
        ? { month: 'long', day: 'numeric' }
        : { year: 'numeric', month: 'long', day: 'numeric' });
    }

    function sameDay(a, b) {
      const da = new Date(a), db = new Date(b);
      return da.toDateString() === db.toDateString();
    }

    // ─── Sanitize ─────────────────────────────────────────────────────────────────
    function safe(str = '') {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function normalizeDetectedUrlCandidate(raw = '') {
      let url = (raw || '').trim();
      let trailing = '';
      while (url && /[),.!?;:]/.test(url[url.length - 1])) {
        trailing = url[url.length - 1] + trailing;
        url = url.slice(0, -1);
      }
      return { url, trailing };
    }

    function normalizeNavigableUrl(raw = '') {
      const candidate = String(raw || '').trim();
      if (!candidate || /[\u0000-\u001f\u007f\\]/.test(candidate)) return null;
      try {
        const parsed = new URL(candidate, location.origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        if (parsed.username || parsed.password) return null;
        return parsed.toString();
      } catch {
        return null;
      }
    }

    function normalizeDisplayUrl(raw = '') {
      const candidate = String(raw || '').trim();
      if (!candidate || /[\u0000-\u001f\u007f\\]/.test(candidate)) return null;
      if (candidate.startsWith('/media/')) {
        if (candidate.includes('/../') || candidate.endsWith('/..') || candidate.startsWith('/media/../')) return null;
        return candidate;
      }
      return normalizeNavigableUrl(candidate);
    }

    function extractHttpLinks(text = '') {
      const urls = [];
      const seen = new Set();
      const regex = /https?:\/\/[^\s`]+/gi;
      let match;
      while ((match = regex.exec(text || '')) !== null) {
        const { url } = normalizeDetectedUrlCandidate(match[0]);
        const normalized = normalizeNavigableUrl(url);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        urls.push(normalized);
      }
      return urls;
    }

    function renderMentionText(text = '') {
      return safe(text).replace(/@(\w+)/g, '<span class="mention">@$1</span>');
    }

    function renderTextWithLinks(text = '') {
      const regex = /https?:\/\/[^\s`]+/gi;
      let html = '';
      let last = 0;
      let match;

      while ((match = regex.exec(text || '')) !== null) {
        html += renderMentionText((text || '').slice(last, match.index));
        const { url, trailing } = normalizeDetectedUrlCandidate(match[0]);
        const normalized = normalizeNavigableUrl(url);
        if (normalized) {
          const safeUrl = safe(normalized);
          html += `<a class="msg-link" href="${safeUrl}" data-url="${safeUrl}">${safeUrl}</a>`;
        } else {
          html += renderMentionText(match[0]);
        }
        if (trailing) html += safe(trailing);
        last = match.index + match[0].length;
      }

      html += renderMentionText((text || '').slice(last));
      return html;
    }

    function renderContent(text = '') {
      const source = String(text || '');
      const codeRegex = /`([^`]+)`/g;
      let html = '';
      let cursor = 0;
      let match;

      while ((match = codeRegex.exec(source)) !== null) {
        html += renderTextWithLinks(source.slice(cursor, match.index));
        html += `<code>${safe(match[1])}</code>`;
        cursor = match.index + match[0].length;
      }

      html += renderTextWithLinks(source.slice(cursor));
      return html;
    }

    function toAttachmentObj(att) {
      if (!att) return null;
      if (typeof att === 'string') {
        const url = normalizeDisplayUrl(att);
        if (!url) return null;
        return { url, filename: attachmentFilenameFromUrl(url) };
      }
      if (typeof att === 'object' && att.url) {
        const url = normalizeDisplayUrl(att.url);
        if (!url) return null;
        return { url, filename: att.filename || attachmentFilenameFromUrl(url) };
      }
      return null;
    }

    function attachmentFilenameFromUrl(url = '') {
      try {
        const path = url.startsWith('/media/') ? url : new URL(url, location.origin).pathname;
        const parts = path.split('/');
        return decodeURIComponent(parts[parts.length - 1] || 'Attachment');
      } catch {
        return 'Attachment';
      }
    }

    function mediaKind(url = '') {
      const lower = url.toLowerCase().split('?')[0];
      if (/\.(png|jpe?g|gif|webp|bmp|avif)$/.test(lower)) return 'image';
      if (/\.(mp4|webm|mov|m4v|mkv)$/.test(lower)) return 'video';
      if (/\.(mp3|wav|ogg|m4a|flac)$/.test(lower)) return 'audio';
      return 'file';
    }

    function extractMediaUrls(text = '') {
      return (text.match(/\/media\/[^\s]+/g) || []);
    }

    function shouldRenderLinkEmbed(url = '') {
      const normalized = normalizeNavigableUrl(url);
      if (!normalized) return false;
      if (normalized.includes('/media/')) return false;
      return mediaKind(normalized) === 'file';
    }

    function isGifUrl(url = '') {
      const normalized = normalizeNavigableUrl(url) || String(url || '').trim();
      const lower = normalized.toLowerCase();
      return /\.gif($|\?)/.test(lower)
        || lower.includes('media.giphy.com/media/')
        || lower.includes('media.tenor.com/');
    }

    function messageContentHidden(message) {
      return !!message?.is_nsfw && !viewerCanSeeNsfw();
    }

    function messagePreviewText(message, maxLength = 90) {
      if (message && typeof message === 'object' && messageContentHidden(message)) {
        return 'NSFW message';
      }
      const source = typeof message === 'string' ? message : String(message?.content || '').trim();
      const attachments = Array.isArray(message?.attachments) ? message.attachments.map(toAttachmentObj).filter(Boolean) : [];
      let preview = source;
      if (!preview) {
        if (attachments.some((item) => isGifUrl(item.url))) preview = 'GIF';
        else if (attachments.length === 1) preview = attachments[0].filename || 'Attachment';
        else if (attachments.length > 1) preview = `${attachments.length} attachments`;
        else preview = 'Message';
      }
      if (preview.length <= maxLength) return preview;
      return `${preview.slice(0, maxLength).trim()}...`;
    }

    function formatLinkTitle(url = '') {
      try {
        const parsed = new URL(url);
        const raw = decodeURIComponent(parsed.pathname || '/');
        const segments = raw.split('/').filter(Boolean);
        if (!segments.length) return parsed.hostname.replace(/^www\./i, '');
        const title = segments[segments.length - 1].replace(/[-_]+/g, ' ').trim();
        return title || parsed.hostname.replace(/^www\./i, '');
      } catch {
        return url;
      }
    }

    function createLinkEmbed(url = '') {
      const normalized = normalizeNavigableUrl(url);
      if (!normalized) return null;

      let host = normalized;
      try {
        host = new URL(normalized).hostname.replace(/^www\./i, '');
      } catch { }

      return el('div', {
        class: 'link-embed',
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          showLinkOpenOptions(normalized);
        }
      },
        el('div', { class: 'link-embed-host' }, host),
        el('div', { class: 'link-embed-title' }, formatLinkTitle(normalized)),
        el('div', { class: 'link-embed-url' }, normalized),
        el('div', { class: 'link-embed-hint' }, 'Click to choose how to open')
      );
    }

    function parseInviteCode(input = '') {
      const raw = (input || '').trim();
      if (!raw) return '';

      try {
        const parsed = new URL(raw, location.origin);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const inviteIdx = parts.findIndex((part) => part.toLowerCase() === 'invite');
        if (inviteIdx >= 0 && parts[inviteIdx + 1]) {
          return decodeURIComponent(parts[inviteIdx + 1]).trim();
        }
      } catch { }

      const stripped = raw.replace(/^wyvern:\/\//i, '');
      return stripped.split(/[/?#]/)[0].trim();
    }

    function inviteCodeFromLocation() {
      const parts = location.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && parts[0].toLowerCase() === 'invite') {
        return decodeURIComponent(parts[1]);
      }
      return null;
    }

    function clearInviteLocation() {
      if (location.pathname.toLowerCase().startsWith('/invite/')) {
        history.replaceState({}, '', '/');
      }
    }

    // ─── Spinner ──────────────────────────────────────────────────────────────────
    function spinner() {
      return el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' }));
    }

    // ─── Modal ────────────────────────────────────────────────────────────────────
    function showModal({ title, placeholder, onConfirm, confirmLabel = 'Create' }) {
      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal' });
      const h = el('h3', {}, title);
      const input = el('input', { class: 'modal-input', type: 'text', placeholder });
      const actions = el('div', { class: 'modal-actions' });
      const cancel = el('button', { class: 'btn-ghost', onClick: () => overlay.remove() }, 'Cancel');
      const confirm = el('button', {
        class: 'btn-confirm',
        onClick: () => {
          const v = input.value.trim();
          if (!v) return;
          onConfirm(v);
          overlay.remove();
        }
      }, confirmLabel);
      actions.append(cancel, confirm);
      modal.append(h, input, actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      setTimeout(() => input.focus(), 50);
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    }

    function showGifPicker({ onSelect }) {
      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal directory-modal' });
      const head = el('div', { class: 'directory-head' },
        el('div', { class: 'directory-title' }, 'GIPHY'),
        el('div', { class: 'directory-subtitle' }, 'Search GIPHY live or paste a direct GIF URL.'),
      );

      const search = el('input', {
        class: 'directory-search gif-picker-search',
        type: 'text',
        placeholder: 'Search GIPHY...',
      });
      const directUrl = el('input', {
        class: 'directory-search',
        type: 'text',
        placeholder: 'https://media.giphy.com/.../giphy.gif',
      });
      const urlHelp = el('div', { class: 'gif-picker-hint' }, 'Direct `.gif` links from Giphy or Tenor work too.');
      const liveStatus = el('div', { class: 'gif-picker-hint' }, 'Loading trending GIFs from GIPHY...');
      const attribution = el('div', { class: 'gif-picker-hint' }, 'Powered by GIPHY');
      const customActions = el('div', { class: 'modal-actions' });
      const useUrlBtn = el('button', {
        class: 'btn-soft',
        type: 'button',
        onClick: () => {
          const nextUrl = normalizeNavigableUrl(directUrl.value || '');
          if (!nextUrl || !isGifUrl(nextUrl)) {
            toast('Paste a direct GIF URL ending in .gif', 'error');
            return;
          }
          onSelect(nextUrl);
          overlay.remove();
        },
      }, 'Use URL');
      customActions.appendChild(useUrlBtn);

      const list = el('div', { class: 'gif-picker-grid' });
      let searchTimer = null;
      let searchRequestId = 0;

      function renderGifCards(items, emptyMessage) {
        list.innerHTML = '';
        if (!items.length) {
          list.appendChild(el('div', { class: 'directory-empty' }, emptyMessage || 'No GIFs matched that search.'));
          return;
        }

        for (const item of items) {
          const card = el('button', {
            class: 'gif-picker-card',
            type: 'button',
            onClick: () => {
              onSelect(item.url);
              overlay.remove();
            },
          },
            el('img', { src: item.url, alt: item.title || 'GIF', loading: 'lazy' }),
            el('div', { class: 'gif-picker-card-copy' },
              el('div', { class: 'gif-picker-card-title' }, item.title || 'GIF'),
              el('span', { class: 'dir-pill' }, item.source === 'giphy' ? 'GIPHY' : 'GIF'),
            )
          );
          list.appendChild(card);
        }
      }

      async function loadGifCards() {
        const currentId = ++searchRequestId;
        const query = (search.value || '').trim();
        liveStatus.textContent = query ? `Searching GIPHY for “${query}”…` : 'Loading trending GIFs from GIPHY…';

        try {
          const result = await fetchGiphyResults(query);
          if (currentId !== searchRequestId) return;
          if (result.disabled) {
            liveStatus.textContent = 'Live GIPHY search is not configured yet. Showing saved GIFs instead.';
          } else {
            liveStatus.textContent = query ? `Live GIPHY results for “${query}”` : 'Trending GIFs from GIPHY';
          }
          renderGifCards(result.items || [], query ? `No live GIPHY results matched “${query}”.` : 'No trending GIFs were returned.');
        } catch (error) {
          if (currentId !== searchRequestId) return;
          console.warn('GIPHY search failed', error);
          liveStatus.textContent = 'Could not load live GIPHY results. Showing saved GIFs instead.';
          renderGifCards(giphyFallbackResults(query), query ? `No saved GIFs matched “${query}”.` : 'No saved GIFs were returned.');
        }
      }

      function queueGifLoad() {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => { void loadGifCards(); }, 250);
      }

      const body = el('div', { class: 'directory-body' },
        search,
        el('div', { class: 'gif-picker-url' }, directUrl, urlHelp, customActions),
        liveStatus,
        list,
        attribution,
      );
      const actions = el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', type: 'button', onClick: () => overlay.remove() }, 'Close'),
      );

      modal.append(head, body, actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      search.addEventListener('input', queueGifLoad);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
      });

      void loadGifCards();
      window.setTimeout(() => search.focus(), 30);
    }

    function showChannelCreateModal({
      title = 'Create Channel',
      placeholder = 'new-channel',
      confirmLabel = 'Create',
      onConfirm,
    }) {
      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal' });
      const heading = el('h3', {}, title);
      const nameInput = el('input', { class: 'modal-input', type: 'text', placeholder });
      const typeSelect = el('select', { class: 'modal-input' },
        el('option', { value: 'text' }, 'Text Channel'),
        el('option', { value: 'voice' }, 'Voice Channel')
      );

      const actions = el('div', { class: 'modal-actions' });
      const cancelBtn = el('button', { class: 'btn-ghost', onClick: () => overlay.remove() }, 'Cancel');
      const createBtn = el('button', {
        class: 'btn-confirm',
        onClick: () => {
          const name = nameInput.value.trim();
          const type = (typeSelect.value || 'text').toLowerCase();
          if (!name) return;
          onConfirm({ name, type: type === 'voice' ? 'voice' : 'text' });
          overlay.remove();
        }
      }, confirmLabel);
      actions.append(cancelBtn, createBtn);

      modal.append(heading, nameInput, typeSelect, actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      setTimeout(() => nameInput.focus(), 50);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
      });
    }

    function showLinkOpenOptions(rawUrl = '') {
      const url = normalizeNavigableUrl(rawUrl);
      if (!url) {
        toast('Invalid link', 'error');
        return;
      }

      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal link-open-modal' });
      const title = el('div', { class: 'link-open-title' }, 'Open Link');
      const urlBox = el('div', { class: 'link-open-url' }, url);

      const cancelBtn = el('button', {
        class: 'btn-ghost',
        onClick: () => overlay.remove(),
      }, 'Cancel');

      const copyBtn = el('button', {
        class: 'btn-ghost',
        onClick: async () => {
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(url);
              toast('Link copied', 'success');
            } else {
              prompt('Copy link', url);
            }
          } catch {
            prompt('Copy link', url);
          }
        },
      }, 'Copy');

      const sameTabBtn = el('button', {
        class: 'btn-confirm',
        onClick: () => {
          overlay.remove();
          window.location.href = url;
        },
      }, 'Open Here');

      const newTabBtn = el('button', {
        class: 'btn-confirm',
        onClick: () => {
          overlay.remove();
          const opened = window.open(url, '_blank', 'noopener,noreferrer');
          if (!opened) toast('Popup blocked by browser', 'error');
        },
      }, 'Open New Tab');

      const actions = el('div', { class: 'link-open-actions' }, cancelBtn, copyBtn, sameTabBtn, newTabBtn);
      modal.append(title, urlBox, actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
      });
    }

    function escapeMarkdownHtml(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function formatMarkdownInline(text) {
      return escapeMarkdownHtml(text)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    }

    function markdownToHtml(markdown) {
      const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
      const html = [];
      let inList = null;
      let inCode = false;
      let codeLines = [];
      let paragraphLines = [];

      const flushParagraph = () => {
        if (!paragraphLines.length) return;
        html.push(`<p>${formatMarkdownInline(paragraphLines.join(' '))}</p>`);
        paragraphLines = [];
      };

      const closeList = () => {
        if (!inList) return;
        html.push(`</${inList}>`);
        inList = null;
      };

      const flushCode = () => {
        html.push(`<pre><code>${escapeMarkdownHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
      };

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();

        if (line.startsWith('```')) {
          if (inCode) {
            flushCode();
            inCode = false;
          } else {
            flushParagraph();
            closeList();
            inCode = true;
          }
          continue;
        }

        if (inCode) {
          codeLines.push(rawLine);
          continue;
        }

        if (!line.trim()) {
          flushParagraph();
          closeList();
          continue;
        }

        const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
        if (headingMatch) {
          flushParagraph();
          closeList();
          const level = headingMatch[1].length;
          html.push(`<h${level}>${formatMarkdownInline(headingMatch[2])}</h${level}>`);
          continue;
        }

        const bulletMatch = line.match(/^[-*]\s+(.+)$/);
        if (bulletMatch) {
          flushParagraph();
          if (inList !== 'ul') {
            closeList();
            html.push('<ul>');
            inList = 'ul';
          }
          html.push(`<li>${formatMarkdownInline(bulletMatch[1])}</li>`);
          continue;
        }

        const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
        if (orderedMatch) {
          flushParagraph();
          if (inList !== 'ol') {
            closeList();
            html.push('<ol>');
            inList = 'ol';
          }
          html.push(`<li>${formatMarkdownInline(orderedMatch[1])}</li>`);
          continue;
        }

        const quoteMatch = line.match(/^>\s+(.+)$/);
        if (quoteMatch) {
          flushParagraph();
          closeList();
          html.push(`<blockquote>${formatMarkdownInline(quoteMatch[1])}</blockquote>`);
          continue;
        }

        paragraphLines.push(line);
      }

      flushParagraph();
      closeList();
      if (inCode && codeLines.length) {
        flushCode();
      }

      return html.join('\n');
    }

    let changelogLoaded = false;

    async function loadChangelog() {
      if (changelogLoaded) return;
      changelogLoaded = true;

      const status = document.getElementById('changelog-status');
      const content = document.getElementById('changelog-content');
      if (!status || !content) return;

      try {
        const res = await fetch(base('/changelog.md'), { cache: 'no-store' });
        if (!res.ok) throw new Error(`Changelog request failed with ${res.status}`);
        const markdown = await res.text();
        content.innerHTML = markdownToHtml(markdown);
        content.hidden = false;
        status.hidden = true;
      } catch (error) {
        status.textContent = 'The changelog could not be loaded right now.';
        content.hidden = true;
        console.error('Failed to load changelog:', error);
      }
    }

    function showChangelogModal() {
      const overlay = document.getElementById('changelog-overlay');
      if (!overlay) return;
      overlay.hidden = false;
    }

    function hideChangelogModal() {
      const overlay = document.getElementById('changelog-overlay');
      if (!overlay) return;
      overlay.hidden = true;
      try {
        localStorage.setItem('changelog_dismissed_v1', 'true');
      } catch (e) {}
    }

    function shouldAutoOpenChangelog() {
      if (!store.state.isAuthed || store.state.view === 'edge-shell') return false;
      try {
        return localStorage.getItem('changelog_dismissed_v1') !== 'true';
      } catch (e) {
        return false;
      }
    }

    function showSettingsModal({
      title,
      subtitle,
      nameLabel,
      namePlaceholder,
      initialName = '',
      iconLabel = 'Icon',
      iconHelp = 'Upload a PNG/JPG/WebP or paste a URL.',
      initialIcon = null,
      detailsLabel = null,
      detailsPlaceholder = '',
      initialDetails = '',
      detailsMaxLength = 280,
      toggleLabel = null,
      toggleHelp = '',
      initialToggle = false,
      saveLabel = 'Save Changes',
      requireName = true,
      extraActionLabel = null,
      extraSectionRenderer = null,
      extraSectionInitiallyVisible = false,
      modalClassName = '',
      headClassName = '',
      bodyClassName = '',
      onExtraAction = null,
      onSave,
    }) {
      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: `modal settings-modal${modalClassName ? ` ${modalClassName}` : ''}` });

      let iconUrl = (initialIcon || '').trim();
      let detailsValue = String(initialDetails || '');
      let toggleValue = !!initialToggle;
      let saving = false;
      let uploading = false;

      const fileInput = el('input', { type: 'file', accept: 'image/*' });
      fileInput.style.display = 'none';

      const titleEl = el('div', { class: 'settings-title' }, title);
      const subtitleEl = el('div', { class: 'settings-subtitle' }, subtitle || '');
      const head = el('div', { class: `settings-head${headClassName ? ` ${headClassName}` : ''}` }, titleEl, subtitleEl);

      const preview = el('div', { class: 'settings-icon-preview' });
      const nameInput = el('input', {
        class: 'settings-input',
        type: 'text',
        value: initialName || '',
        placeholder: namePlaceholder || '',
        maxlength: '64',
      });
      const iconInput = el('input', {
        class: 'settings-input',
        type: 'text',
        value: iconUrl,
        placeholder: 'https://... or /media/...',
      });
      const iconInputWrap = el('div', { class: 'settings-field' },
        el('label', {}, `${iconLabel} URL`),
        iconInput
      );

      const errEl = el('div', { class: 'settings-error' });
      errEl.style.display = 'none';

      const uploadBtn = el('button', {
        class: 'btn-soft',
        type: 'button',
        onClick: () => {
          if (uploading || saving) return;
          fileInput.click();
        }
      }, 'Upload Image');
      const clearBtn = el('button', {
        class: 'btn-soft btn-danger-ghost',
        type: 'button',
        onClick: () => {
          if (saving || uploading) return;
          iconUrl = '';
          iconInput.value = '';
          renderPreview();
        }
      }, 'Remove Icon');

      const iconMeta = el('div', { class: 'settings-icon-meta' },
        el('div', { class: 'settings-icon-label' }, iconLabel),
        el('div', { class: 'settings-icon-help' }, iconHelp),
        el('div', { class: 'settings-upload-actions' }, uploadBtn, clearBtn)
      );
      const iconRow = el('div', { class: 'settings-icon-row' }, preview, iconMeta);

      const body = el('div', { class: `settings-body${bodyClassName ? ` ${bodyClassName}` : ''}` },
        iconRow,
        iconInputWrap,
        el('div', { class: 'settings-field' },
          el('label', {}, nameLabel),
          nameInput
        ),
        errEl
      );

      let detailsInput = null;
      if (detailsLabel) {
        detailsInput = el('textarea', {
          class: 'settings-textarea',
          placeholder: detailsPlaceholder || '',
          maxlength: String(detailsMaxLength || 280),
        });
        detailsInput.value = detailsValue;
        detailsInput.addEventListener('input', () => {
          detailsValue = detailsInput.value;
        });
        body.appendChild(
          el('div', { class: 'settings-field' },
            el('label', {}, detailsLabel),
            detailsInput,
          )
        );
      }

      const extraSection = typeof extraSectionRenderer === 'function'
        ? el('div', { class: 'settings-extra-section', hidden: 'hidden' })
        : null;
      if (extraSection) {
        extraSection.hidden = !extraSectionInitiallyVisible;
        if (extraSectionInitiallyVisible) {
          extraSectionRenderer(extraSection);
          extraSection.dataset.rendered = '1';
        }
        body.appendChild(extraSection);
      }

      let toggleBtn = null;
      if (toggleLabel) {
        toggleBtn = el('button', {
          class: `settings-switch${toggleValue ? ' on' : ''}`,
          type: 'button',
          onClick: () => {
            if (saving) return;
            toggleValue = !toggleValue;
            toggleBtn.classList.toggle('on', toggleValue);
          },
        });
        body.appendChild(
          el('div', { class: 'settings-toggle' },
            el('div', { class: 'settings-toggle-main' },
              el('div', { class: 'settings-toggle-title' }, toggleLabel),
              el('div', { class: 'settings-toggle-help' }, toggleHelp || ''),
            ),
            toggleBtn,
          )
        );
      }

      body.appendChild(fileInput);

      const cancelBtn = el('button', {
        class: 'btn-ghost',
        type: 'button',
        onClick: () => {
          if (!saving) overlay.remove();
        }
      }, 'Cancel');
      const extraActionBtn = extraActionLabel && (typeof onExtraAction === 'function' || typeof extraSectionRenderer === 'function')
        ? el('button', {
          class: 'btn-soft',
          type: 'button',
          onClick: async () => {
            if (saving) return;
            if (extraSection && typeof extraSectionRenderer === 'function') {
              const willShow = extraSection.hidden !== false;
              extraSection.hidden = !willShow;
              if (willShow && !extraSection.dataset.rendered) {
                extraSection.innerHTML = '';
                extraSectionRenderer(extraSection);
                extraSection.dataset.rendered = '1';
              }
              return;
            }
            await onExtraAction();
          },
        }, extraActionLabel)
        : null;
      const saveBtn = el('button', { class: 'btn-confirm', type: 'button' }, saveLabel);

      const actions = el('div', { class: 'settings-actions' }, cancelBtn, extraActionBtn, saveBtn);
      modal.append(head, body, actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      function setError(message = '') {
        const msg = (message || '').trim();
        if (!msg) {
          errEl.style.display = 'none';
          errEl.textContent = '';
          return;
        }
        errEl.textContent = msg;
        errEl.style.display = 'block';
      }

      function setBusyState() {
        uploadBtn.disabled = saving || uploading;
        clearBtn.disabled = saving || uploading;
        iconInput.disabled = saving || uploading;
        nameInput.disabled = saving;
        if (detailsInput) detailsInput.disabled = saving;
        if (toggleBtn) toggleBtn.disabled = saving;
        saveBtn.disabled = saving || uploading;
        saveBtn.textContent = saving ? 'Saving...' : saveLabel;
        uploadBtn.textContent = uploading ? 'Uploading...' : 'Upload Image';
      }

      function previewText() {
        const source = nameInput.value?.trim() || initialName || iconLabel || '?';
        return initials(source || '?');
      }

      function renderPreview() {
        preview.innerHTML = '';
        const nextUrl = (iconUrl || '').trim();
        if (!nextUrl) {
          preview.appendChild(el('span', { class: 'settings-icon-fallback' }, previewText()));
          return;
        }
        const img = el('img', { src: nextUrl, alt: `${iconLabel} preview` });
        img.addEventListener('error', () => {
          if (!preview.contains(img)) return;
          preview.innerHTML = '';
          preview.appendChild(el('span', { class: 'settings-icon-fallback' }, previewText()));
        });
        preview.appendChild(img);
      }

      iconInput.addEventListener('input', () => {
        iconUrl = iconInput.value.trim();
        renderPreview();
      });
      nameInput.addEventListener('input', () => {
        if (!(iconUrl || '').trim()) renderPreview();
      });

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;
        setError('');
        uploading = true;
        setBusyState();
        try {
          toast(`Uploading ${file.name}...`, 'info', 5000);
          const result = await uploads.upload(file);
          const uploadedUrl = (result?.url || result?.file_url || '').trim();
          if (!uploadedUrl) throw new Error('Upload response missing URL');
          iconUrl = uploadedUrl;
          iconInput.value = uploadedUrl;
          renderPreview();
          toast('Image uploaded', 'success');
        } catch (err) {
          setError(err?.message || 'Failed to upload image');
          toast(err?.message || 'Failed to upload image', 'error');
        } finally {
          uploading = false;
          setBusyState();
        }
      });

      saveBtn.addEventListener('click', async () => {
        if (saving || uploading) return;
        setError('');
        const name = nameInput.value.trim();
        if (requireName && !name) {
          setError(`${nameLabel} is required`);
          return;
        }
        saving = true;
        setBusyState();
        try {
          await onSave({
            name,
            icon: (iconUrl || '').trim() || null,
            details: detailsInput ? detailsValue.trim() : '',
            toggle: !!toggleValue,
          });
          overlay.remove();
        } catch (err) {
          setError(err?.message || 'Failed to save changes');
        } finally {
          saving = false;
          setBusyState();
        }
      });

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay && !saving) overlay.remove();
      });
      window.setTimeout(() => nameInput.focus(), 30);
      renderPreview();
      setBusyState();
    }

    const EDGE_MODE_WARNING_COPY = `You are enabling the live development environment.
Changes are deployed instantly as code is written and saved.

This is not stable. Things will break.
Data and behavior are not guaranteed.

If you do not fully understand these risks, do not enable this mode.`;

    function edgeTargetLabel() {
      return `${window.location.origin}${edgePathPrefix()}/`;
    }

    function showEdgeModeWarning() {
      return new Promise((resolve) => {
        const overlay = el('div', { class: 'modal-overlay' });
        const modal = el('div', { class: 'modal edge-warning-modal' });
        const title = el('div', { class: 'edge-warning-title' }, '⚠️ Edge Mode (Developer Only)');
        const copy = el('div', { class: 'edge-warning-copy' }, EDGE_MODE_WARNING_COPY);
        const actions = el('div', { class: 'modal-actions' });

        const close = (result) => {
          overlay.remove();
          resolve(!!result);
        };

        actions.append(
          el('button', { class: 'btn-ghost', type: 'button', onClick: () => close(false) }, 'Cancel'),
          el('button', { class: 'btn-confirm', type: 'button', onClick: () => close(true) }, 'I understand'),
        );

        modal.append(title, copy, actions);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close(false);
        });
      });
    }

    function disableEdgeMode() {
      setEdgeModeEnabled(false);
      if (window.parent && window.parent !== window) {
        token.clear();
        window.parent.postMessage({ type: 'wyvern.edge.disable' }, window.location.origin);
        return;
      }
      if (currentClientMode() === 'edge') {
        window.location.replace('/');
        return;
      }
      store.set({ view: 'app' });
    }

    function buildServerIntegrationsSection(serverId) {
      const normalizedServerId = idKey(serverId) || null;
      const container = el('div', { class: 'server-settings-stack' });
      if (!normalizedServerId) {
        container.appendChild(el('div', { class: 'community-empty' }, 'Select a server first.'));
        return container;
      }
      if (!canManageWebhooks(normalizedServerId)) {
        container.appendChild(el('div', { class: 'community-empty' }, 'You need owner or admin permissions to manage webhooks.'));
        return container;
      }

      let webhookEntries = [];
      let deliveriesByWebhook = new Map();
      let createSecret = null;
      let loading = false;

      async function ensureServerChannelsLoaded() {
        if (store.state.channels?.[normalizedServerId]) return;
        try {
          const loaded = await channels.list(normalizedServerId);
          store.set({
            channels: {
              ...(store.state.channels || {}),
              [normalizedServerId]: loaded || [],
            },
          });
        } catch { }
      }

      async function loadWebhooks() {
        loading = true;
        renderBody();
        try {
          await ensureServerChannelsLoaded();
          const data = await community.webhooks.list(normalizedServerId);
          webhookEntries = Array.isArray(data) ? data : (data?.items || []);
        } catch (error) {
          webhookEntries = [];
          toast(error?.message || 'Failed to load webhooks', 'error');
        } finally {
          loading = false;
          renderBody();
        }
      }

      async function loadDeliveries(webhookId) {
        try {
          const data = await community.webhooks.deliveries(normalizedServerId, webhookId);
          const items = Array.isArray(data) ? data : (data?.items || []);
          deliveriesByWebhook.set(webhookId, items);
          renderBody();
        } catch (error) {
          toast(error?.message || 'Could not load deliveries', 'error');
        }
      }

      function renderBody() {
        container.innerHTML = '';
        const textChannels = (store.state.channels?.[normalizedServerId] || []).filter((channel) => String(channel.type || '').toLowerCase() === 'text');
        const createCard = el('div', { class: 'settings-card' },
          el('div', { class: 'settings-section-kicker' }, 'Integrations'),
          el('div', { class: 'community-secret-title' }, 'Create Webhook'),
          el('div', { class: 'community-secret-copy' }, 'Webhooks can post into a designated text channel with a signed token.'),
          !textChannels.length ? el('div', { class: 'community-empty' }, 'This server has no text channels yet.') : null
        );
        const formName = el('input', { class: 'community-input', type: 'text', placeholder: 'Webhook name' });
        const formDesc = el('input', { class: 'community-input', type: 'text', placeholder: 'Optional description' });
        const channelSelect = el('select', { class: 'community-select' }, ...textChannels.map((channel) => el('option', { value: String(channel.id) }, `#${channel.name || 'channel'}`)));
        const createBtn = el('button', { class: 'btn-confirm', type: 'button' }, 'Create Webhook');
        createBtn.disabled = !textChannels.length;
        createBtn.addEventListener('click', async () => {
          const name = formName.value.trim();
          const channelId = idKey(channelSelect.value);
          if (!name || !channelId) {
            toast('Choose a name and target channel', 'error');
            return;
          }
          try {
            const created = await community.webhooks.create(normalizedServerId, {
              name,
              description: formDesc.value.trim() || null,
              channel_id: channelId,
            });
            createSecret = created;
            formName.value = '';
            formDesc.value = '';
            await loadWebhooks();
          } catch (error) {
            toast(error?.message || 'Failed to create webhook', 'error');
          }
        });
        createCard.append(
          el('div', { class: 'community-secret-row' }, formName),
          el('div', { class: 'community-secret-row' }, formDesc),
          el('div', { class: 'community-secret-row' }, channelSelect),
          el('div', { class: 'community-secret-row' }, createBtn),
        );

        const secretPanel = createSecret ? el('div', { class: 'community-secret-panel' },
          el('div', { class: 'community-secret-title' }, 'Webhook Created'),
          el('div', { class: 'community-secret-copy' }, 'Copy the token now. You will not be able to see it again.'),
          el('div', { class: 'community-secret-row' },
            el('input', { class: 'community-input', type: 'text', readonly: 'readonly', value: createSecret.token || '' }),
            el('button', {
              class: 'btn-soft', type: 'button', onClick: async () => {
                await navigator.clipboard?.writeText(createSecret.token || '').catch(() => { });
                toast('Token copied', 'success');
              }
            }, 'Copy Token')
          ),
          el('div', { class: 'community-secret-row' },
            el('input', { class: 'community-input', type: 'text', readonly: 'readonly', value: createSecret.webhook_url || '' }),
            el('button', {
              class: 'btn-soft', type: 'button', onClick: async () => {
                await navigator.clipboard?.writeText(createSecret.webhook_url || '').catch(() => { });
                toast('Webhook URL copied', 'success');
              }
            }, 'Copy URL')
          )
        ) : null;

        const cards = el('div', { class: 'community-results-list' });
        if (!webhookEntries.length) {
          cards.appendChild(el('div', { class: 'community-empty' }, loading ? 'Loading webhooks...' : 'No webhooks yet.'));
        } else {
          for (const webhook of webhookEntries) {
            const deliveries = deliveriesByWebhook.get(webhook.id) || [];
            const deliveryRows = deliveries.length
              ? deliveries.map((delivery) =>
                el('div', { class: 'community-delivery-row' },
                  el('div', { class: 'community-delivery-title' }, `${delivery.status} • ${delivery.attempts} attempt(s)`),
                  el('div', { class: 'community-delivery-meta' }, delivery.response_message || 'No response message'),
                  el('div', { class: 'community-delivery-time' }, fmtTime(delivery.created_at))
                )
              )
              : [el('div', { class: 'community-empty' }, 'No delivery logs loaded.')];

            cards.appendChild(
              el('div', { class: 'settings-card' },
                el('div', { class: 'community-result-head' },
                  el('div', { class: 'community-result-meta' },
                    el('div', { class: 'community-result-title' }, webhook.name, webhook.active ? null : el('span', { class: 'mini-pill' }, 'Disabled')),
                    el('div', { class: 'community-result-subtitle' }, `${resolveChannelLabel(webhook.channel_id)} • ${webhook.description || 'No description'}`)
                  )
                ),
                el('div', { class: 'community-card-actions' },
                  webhook.webhook_url ? el('button', {
                    class: 'btn-soft', type: 'button', onClick: async () => {
                      await navigator.clipboard?.writeText(webhook.webhook_url || '').catch(() => { });
                      toast('Webhook URL copied', 'success');
                    }
                  }, 'Copy URL') : el('button', { class: 'btn-soft', type: 'button', disabled: true }, 'URL Hidden'),
                  el('button', { class: 'btn-soft', type: 'button', onClick: () => loadDeliveries(webhook.id) }, 'View Deliveries'),
                  el('button', {
                    class: 'btn-soft btn-danger-ghost', type: 'button', onClick: async () => {
                      try {
                        await community.webhooks.delete(webhook.id);
                        await loadWebhooks();
                      } catch (error) {
                        toast(error?.message || 'Could not delete webhook', 'error');
                      }
                    }
                  }, 'Delete'),
                ),
                el('div', { class: 'community-delivery-list' }, ...deliveryRows)
              )
            );
          }
        }

        container.replaceChildren(...[secretPanel, createCard, cards].filter(Boolean));
      }

      void loadWebhooks();
      return container;
    }

    function showServerIntegrationsModal(serverId) {
      showServerSettingsHub(serverId, 'integrations');
    }

    function connectorsAllowedForCurrentContext() {
      if (!(currentClientMode() === 'edge' && isUiA())) return true;
      return !!store.state.user?.is_admin;
    }

    function defaultSettingsSection() {
      return connectorsAllowedForCurrentContext() && currentClientMode() === 'edge' && isUiA() ? 'connectors' : 'account';
    }

    function showSettingsHub(initialSection = 'account') {
      const { user } = store.state;
      if (!user) return;

      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal settings-hub-modal' });
      const shell = el('div', { class: 'settings-hub-shell' });
      const nav = el('div', { class: 'settings-hub-nav' },
        el('div', { class: 'settings-hub-nav-title' }, 'Preferences')
      );
      const panel = el('div', { class: 'settings-hub-panel' });
      const head = el('div', { class: 'settings-head' });
      const title = el('div', { class: 'settings-title' }, 'Settings');
      const subtitle = el('div', { class: 'settings-subtitle' }, 'Manage your profile, connectors, API access, and preview features.');
      const content = el('div', { class: 'settings-hub-content' });
      const signOut = async () => {
        overlay.remove();
        await signOutUser();
      };
      const footer = el('div', { class: 'settings-actions' },
        el('button', {
          class: 'btn-soft btn-danger-ghost',
          type: 'button',
          onClick: signOut,
        }, heroIcon('arrowLeftOnRectangle', { size: 16 }), 'Sign Out'),
        el('button', { class: 'btn-ghost', type: 'button', onClick: () => overlay.remove() }, 'Close')
      );
      const connectorsAllowed = connectorsAllowedForCurrentContext();
      let section = ['account', 'connectors', 'api', 'chat', 'ai'].includes(initialSection)
        ? (['chat', 'ai'].includes(initialSection) ? 'api' : initialSection)
        : 'account';
      if (section === 'connectors' && !connectorsAllowed) {
        section = 'account';
      }

      head.append(title, subtitle);
      panel.append(head, content, footer);
      shell.append(nav, panel);
      modal.appendChild(shell);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const persistProfile = async ({ name, icon, details, toggle, aiOptIn, nsfw18Verified }) => {
        const currentPresence = store.state.user?.presence || 'online';
        const updatedBase = await users.update({
          display_name: name || null,
          bio: details || null,
          avatar: icon,
          directory_opt_in: !!toggle,
          ai_opt_in: !!aiOptIn,
          nsfw_18_verified: !!nsfw18Verified,
        });
        const updated = { ...(updatedBase || {}), presence: store.state.user?.presence || currentPresence };
        if (updated?.id) userCache.set(updated.id, updated);

        const nextMembers = {};
        for (const [serverId, mems] of Object.entries(store.state.members || {})) {
          nextMembers[serverId] = (mems || []).map((member) => {
            if (!idsEqual(member.user_id, updated?.id)) return member;
            return { ...member, user: { ...(member.user || {}), ...(updated || {}) } };
          });
        }

        const nextDmList = (store.state.dmList || []).map((dm) => {
          if (!Array.isArray(dm?.participants)) return dm;
          return {
            ...dm,
            participants: dm.participants.map((p) => idsEqual(p?.id, updated?.id) ? { ...p, ...(updated || {}) } : p),
          };
        });

        store.set({
          user: updated || user,
          members: nextMembers,
          dmList: nextDmList,
        });
        rerenderCurrentView();
        toast('Profile updated', 'success');
      };

      function renderAccountSection() {
        let iconUrl = (store.state.user?.avatar || '').trim();
        let toggleValue = !!store.state.user?.directory_opt_in;
        let detailsValue = String(store.state.user?.bio || '');
        let aiOptInValue = !!store.state.user?.ai_opt_in;
        let nsfwVerifiedValue = !!store.state.user?.nsfw_18_verified;
        let saving = false;
        let uploading = false;
        const fileInput = el('input', { type: 'file', accept: 'image/*' });
        fileInput.style.display = 'none';

        const preview = el('div', { class: 'settings-icon-preview' });
        const nameInput = el('input', {
          class: 'settings-input',
          type: 'text',
          value: store.state.user?.display_name || store.state.user?.username || '',
          placeholder: store.state.user?.username || 'Display Name',
          maxlength: '64',
        });
        const iconInput = el('input', {
          class: 'settings-input',
          type: 'text',
          value: iconUrl,
          placeholder: 'https://... or /media/...',
        });
        const bioInput = el('textarea', {
          class: 'settings-textarea',
          maxlength: '280',
          placeholder: 'Tell people a bit about yourself.',
        }, detailsValue);
        bioInput.value = detailsValue;
        const errorEl = el('div', { class: 'settings-error' });
        errorEl.style.display = 'none';
        const switchBtn = el('button', { class: `settings-switch${toggleValue ? ' on' : ''}`, type: 'button' });
        const aiOptInSwitch = el('button', { class: `settings-switch${aiOptInValue ? ' on' : ''}`, type: 'button' });
        const nsfwVerifiedSwitch = el('button', { class: `settings-switch${nsfwVerifiedValue ? ' on' : ''}`, type: 'button' });
        const saveBtn = el('button', { class: 'btn-confirm', type: 'button' }, 'Save Profile');

        const updatePreview = () => {
          preview.innerHTML = '';
          const currentName = (nameInput.value || store.state.user?.username || 'U').trim();
          const fallback = currentName.slice(0, 2).toUpperCase() || 'U';
          const src = (iconUrl || '').trim();
          if (src) {
            const img = el('img', { src, alt: currentName || 'Profile image' });
            img.addEventListener('error', () => {
              preview.innerHTML = '';
              preview.appendChild(el('span', { class: 'settings-icon-fallback' }, fallback));
            });
            preview.appendChild(img);
          } else {
            preview.appendChild(el('span', { class: 'settings-icon-fallback' }, fallback));
          }
        };

        const setBusy = () => {
          saveBtn.disabled = saving || uploading;
          switchBtn.disabled = saving || uploading;
          aiOptInSwitch.disabled = saving || uploading;
          nsfwVerifiedSwitch.disabled = saving || uploading;
        };

        const setError = (message) => {
          errorEl.textContent = message || '';
          errorEl.style.display = message ? 'block' : 'none';
        };

        iconInput.addEventListener('input', () => {
          iconUrl = iconInput.value.trim();
          updatePreview();
        });
        nameInput.addEventListener('input', updatePreview);
        bioInput.addEventListener('input', () => {
          detailsValue = bioInput.value;
        });
        switchBtn.addEventListener('click', () => {
          if (saving || uploading) return;
          toggleValue = !toggleValue;
          switchBtn.classList.toggle('on', toggleValue);
        });
        aiOptInSwitch.addEventListener('click', () => {
          if (saving || uploading) return;
          aiOptInValue = !aiOptInValue;
          aiOptInSwitch.classList.toggle('on', aiOptInValue);
        });
        nsfwVerifiedSwitch.addEventListener('click', () => {
          if (saving || uploading) return;
          nsfwVerifiedValue = !nsfwVerifiedValue;
          nsfwVerifiedSwitch.classList.toggle('on', nsfwVerifiedValue);
        });

        fileInput.addEventListener('change', async () => {
          const file = fileInput.files?.[0];
          fileInput.value = '';
          if (!file) return;
          setError('');
          uploading = true;
          setBusy();
          try {
            toast(`Uploading ${file.name}...`, 'info', 5000);
            const result = await uploads.upload(file);
            const uploadedUrl = (result?.url || result?.file_url || '').trim();
            if (!uploadedUrl) throw new Error('Upload response missing URL');
            iconUrl = uploadedUrl;
            iconInput.value = uploadedUrl;
            updatePreview();
            toast('Image uploaded', 'success');
          } catch (err) {
            setError(err?.message || 'Failed to upload image');
            toast(err?.message || 'Failed to upload image', 'error');
          } finally {
            uploading = false;
            setBusy();
          }
        });

        saveBtn.addEventListener('click', async () => {
          if (saving || uploading) return;
          saving = true;
          saveBtn.textContent = 'Saving...';
          setBusy();
          setError('');
          try {
            await persistProfile({
              name: nameInput.value.trim(),
              icon: (iconUrl || '').trim() || null,
              details: bioInput.value.trim(),
              toggle: toggleValue,
              aiOptIn: aiOptInValue,
              nsfw18Verified: nsfwVerifiedValue,
            });
            saveBtn.textContent = 'Save Profile';
          } catch (err) {
            setError(err?.message || 'Failed to save profile');
            saveBtn.textContent = 'Save Profile';
          } finally {
            saving = false;
            setBusy();
          }
        });

        updatePreview();
        content.append(
          el('div', { class: 'settings-section-kicker' }, 'Profile'),
          el('div', { class: 'settings-section-intro' }, 'Choose how your profile appears across Wyvern, including your name, picture, and account preferences.'),
          el('div', { class: 'settings-card' },
            el('div', { class: 'settings-icon-row' },
              preview,
              el('div', { class: 'settings-icon-meta' },
                el('div', { class: 'settings-icon-label' }, 'Profile Picture'),
                el('div', { class: 'settings-icon-help' }, 'Upload a PNG/JPG/WebP or paste a URL.'),
                el('div', { class: 'settings-upload-actions' },
                  el('button', { class: 'btn-soft', type: 'button', onClick: () => fileInput.click() }, 'Upload Image'),
                  el('button', { class: 'btn-soft btn-danger-ghost', type: 'button', onClick: () => { iconUrl = ''; iconInput.value = ''; updatePreview(); } }, 'Clear')
                ),
                fileInput,
              )
            ),
            el('div', { class: 'settings-field' }, el('label', {}, 'Display Name'), nameInput),
            el('div', { class: 'settings-field' }, el('label', {}, 'Profile Picture URL'), iconInput),
            el('div', { class: 'settings-field' }, el('label', {}, 'Bio'), bioInput),
            el('div', { class: 'settings-toggle' },
              el('div', { class: 'settings-toggle-main' },
                el('div', { class: 'settings-toggle-title' }, 'Show In User Directory'),
                el('div', { class: 'settings-toggle-help' }, 'People can discover you and start a DM from User Directory.')
              ),
              switchBtn
            ),
            el('div', { class: 'settings-toggle' },
              el('div', { class: 'settings-toggle-main' },
                el('div', { class: 'settings-toggle-title' }, 'Allow AI Improvement Use'),
                el('div', { class: 'settings-toggle-help' }, 'Opt in if Wyvern may use your content to improve AI systems and features.')
              ),
              aiOptInSwitch
            ),
            el('div', { class: 'settings-toggle' },
              el('div', { class: 'settings-toggle-main' },
                el('div', { class: 'settings-toggle-title' }, '18+ NSFW Access'),
                el('div', { class: 'settings-toggle-help' }, 'Self-attest that you are 18 or older so NSFW-labeled messages can be shown to you.')
              ),
              nsfwVerifiedSwitch
            ),
            errorEl,
            el('div', { class: 'settings-inline-actions' }, saveBtn),
          ),
        );
      }

      function buildChatSoonCard() {
        const enabled = false;
        return el('div', { class: 'settings-card settings-card-muted' },
          el('div', { class: 'settings-toggle' },
            el('div', { class: 'settings-toggle-main' },
              el('div', { class: 'settings-toggle-title' }, 'Wyvern Chat Bots'),
              el('div', { class: 'settings-toggle-help' }, 'Coming soon: users will be able to create bots on Wyvern here.')
            ),
            el('button', {
              class: `settings-switch${enabled ? ' on' : ''}`,
              type: 'button',
              disabled: true,
              'aria-label': 'Chat bots coming soon',
            })
          ),
          el('div', { class: 'settings-card-copy' },
            'This section is intentionally greyed out for now. It will become the home for bot creation, bot settings, and future Wyvern agent tools.'
          ),
          el('div', { class: 'settings-meta-grid' },
            el('div', { class: 'settings-meta-chip' },
              el('div', { class: 'settings-meta-label' }, 'State'),
              el('div', { class: 'settings-meta-value' }, 'Coming soon')
            ),
            el('div', { class: 'settings-meta-chip' },
              el('div', { class: 'settings-meta-label' }, 'Purpose'),
              el('div', { class: 'settings-meta-value' }, 'User-created bots')
            )
          ),
          el('div', { class: 'settings-warning-copy' }, 'Chat is disabled until the bot-creation workflow is ready.')
        );
      }

      function buildEdgeModeCard() {
        const enabled = isEdgeModeEnabled();
        const canEnable = edgeModeCanBoot();
        const description = canEnable
          ? 'Edge Mode lets you preview Wyvern\'s live development environment in this browser before changes reach the main app. It may include unfinished features, visual issues, or temporary instability, so leave it off unless you specifically want to test upcoming work.'
          : 'Edge Mode is not available on this host right now. When it is enabled for this environment, you will be able to preview Wyvern\'s in-progress experience here before it rolls into the main app.';
        const toggleEdgeMode = async () => {
          if (enabled) {
            disableEdgeMode();
            toast('Edge Mode disabled for this browser', 'success');
            renderSection();
            return;
          }
          if (!canEnable) {
            toast('Edge Mode is not configured on this environment yet', 'error');
            return;
          }
          const confirmed = await showEdgeModeWarning();
          if (!confirmed) return;
          setEdgeModeEnabled(true);
          overlay.remove();
          store.set({ view: resolvePostAuthView(store.state.user) });
        };

        const switchBtn = el('button', {
          class: `settings-switch${enabled ? ' on' : ''}`,
          type: 'button',
          onClick: toggleEdgeMode,
          title: enabled ? 'Disable Edge Mode' : 'Enable Edge Mode',
          'aria-label': enabled ? 'Disable Edge Mode' : 'Enable Edge Mode',
        });

        return el('div', { class: 'settings-card' },
          el('div', { class: 'settings-toggle' },
            el('div', { class: 'settings-toggle-main' },
              el('div', { class: 'settings-toggle-title' }, 'Edge Mode'),
              el('div', { class: 'settings-toggle-help' }, 'Preview upcoming Wyvern changes before they reach the main app.')
            ),
            switchBtn
          ),
          el('div', { class: 'settings-card-copy' }, description),
        );
      }

      function renderConnectorsSection() {
        const container = el('div', { class: 'settings-section-stack' });
        let mcpConnection = null;
        let mcpLoading = true;
        let statusMessage = '';
        let usingFallbackConnection = false;

        const buildFallbackMcpConnection = () => ({
          server_url: `${window.location.origin.replace(/\/$/, '')}/mcp`,
          app_name: 'Wyvern',
          recommended_client: 'ChatGPT Apps',
          auth_method: 'OAuth 2.1',
          published_ready: true,
        });

        const refreshMcpConnection = async () => {
          mcpLoading = true;
          redraw();
          try {
            const payload = await ai.mcp.get();
            mcpConnection = payload?.connection || buildFallbackMcpConnection();
            usingFallbackConnection = !payload?.connection;
            statusMessage = usingFallbackConnection
              ? 'Using the default Wyvern MCP URL.'
              : '';
          } catch (err) {
            mcpConnection = buildFallbackMcpConnection();
            usingFallbackConnection = true;
            statusMessage = 'Using the default Wyvern MCP URL because live connector metadata could not be loaded right now.';
          } finally {
            mcpLoading = false;
            redraw();
          }
        };

        const copyValue = async (value, successLabel = 'Copied') => {
          if (!value) return;
          try {
            await navigator.clipboard.writeText(value);
            toast(successLabel, 'success');
          } catch {
            toast('Could not copy', 'error');
          }
        };

        const redraw = () => {
          container.innerHTML = '';

          const chatgptCardChildren = [];
          if (mcpLoading) {
            chatgptCardChildren.push(el('div', { class: 'settings-card-copy' }, 'Loading the public Wyvern MCP endpoint...'));
          } else {
            const serverUrl = mcpConnection?.server_url || '';
            const serverUrlInput = el('input', {
              class: 'settings-input ai-token-secret-input',
              type: 'text',
              readOnly: 'true',
              value: serverUrl,
              placeholder: 'Public Wyvern MCP URL',
            });
            const copyUrlBtn = el('button', {
              class: 'btn-soft',
              type: 'button',
              disabled: !serverUrl,
              onClick: () => copyValue(serverUrl, 'Connector URL copied'),
            }, 'Copy URL');

            if (statusMessage) {
              chatgptCardChildren.push(el('div', { class: 'settings-card-copy' }, statusMessage));
            }

            chatgptCardChildren.push(
              el('div', { class: 'settings-card-copy' }, 'Connect Wyvern to ChatGPT with one public MCP URL and official account linking. No bearer tokens or API setup required.'),
              el('div', { class: 'settings-meta-grid' },
                el('div', { class: 'settings-meta-chip' },
                  el('div', { class: 'settings-meta-label' }, 'Client'),
                  el('div', { class: 'settings-meta-value' }, 'ChatGPT Apps')
                ),
                el('div', { class: 'settings-meta-chip' },
                  el('div', { class: 'settings-meta-label' }, 'Access'),
                  el('div', { class: 'settings-meta-value' }, 'OAuth read-only MCP')
                ),
                el('div', { class: 'settings-meta-chip' },
                  el('div', { class: 'settings-meta-label' }, 'Status'),
                  el('div', { class: 'settings-meta-value' }, mcpConnection ? (usingFallbackConnection ? 'Fallback ready' : 'Publish-ready') : 'Unavailable')
                )
              ),
              el('div', { class: 'settings-field' },
                el('label', {}, 'Public MCP URL'),
                el('div', { class: 'ai-token-secret-row' }, serverUrlInput, copyUrlBtn)
              ),
              el('div', { class: 'settings-card-copy' },
                'For testing, create a custom connector in ChatGPT and paste this URL. After the app is published through OpenAI, users will just click Connect and sign into Wyvern with OAuth.'
              )
            );
          }

          const chatgptCard = el('div', { class: 'settings-card' }, ...chatgptCardChildren);

          container.append(
            el('div', { class: 'settings-section-kicker' }, 'Connectors'),
            el('div', { class: 'settings-section-intro' }, 'Connect Wyvern to chat apps and other user-friendly tools without manual API setup.'),
            chatgptCard
          );
        };

        void refreshMcpConnection();
        return container;
      }

      function renderApiSection() {
        const container = el('div', { class: 'settings-section-stack' });
        let tokens = [];
        let loadingTokens = true;
        let canManageTokens = true;
        let recentToken = null;
        let statusMessage = '';
        let createName = '';
        let busy = false;

        const refreshTokens = async () => {
          loadingTokens = true;
          redraw();
          try {
            const payload = await ai.apiTokens.list();
            tokens = Array.isArray(payload?.tokens) ? payload.tokens : [];
            canManageTokens = true;
          } catch (err) {
            tokens = [];
            canManageTokens = false;
            statusMessage = err?.message || 'API token management is not available right now.';
          } finally {
            loadingTokens = false;
            redraw();
          }
        };

        const setBusy = (value) => {
          busy = !!value;
          redraw();
        };

        const copySecret = async (secret) => {
          if (!secret) return;
          try {
            await navigator.clipboard.writeText(secret);
            toast('Token copied', 'success');
          } catch {
            toast('Could not copy token', 'error');
          }
        };

        const redraw = () => {
          container.innerHTML = '';
          const wyvBase = wyvPublicBaseUrl();
          const wyvApiBase = wyvBase ? `${wyvBase}/openai/v1` : '/openai/v1';

          const accessCard = el('div', { class: 'settings-card' },
            el('div', { class: 'settings-card-copy' },
              'Use Wyvern API tokens to connect Wyv and other approved apps, tools, and automations to your account.',
            ),
            el('div', { class: 'settings-meta-grid' },
              el('div', { class: 'settings-meta-chip' },
                el('div', { class: 'settings-meta-label' }, 'API Base'),
                el('div', { class: 'settings-meta-value' }, wyvApiBase)
              ),
              el('div', { class: 'settings-meta-chip' },
                el('div', { class: 'settings-meta-label' }, 'Auth'),
                el('div', { class: 'settings-meta-value' }, 'Authorization: Bearer <api token>')
              ),
              el('div', { class: 'settings-meta-chip' },
                el('div', { class: 'settings-meta-label' }, 'Status'),
                el('div', { class: 'settings-meta-value' }, canManageTokens ? 'Admin-managed rollout' : 'Access limited')
              )
            ),
            el('div', { class: 'settings-warning-copy' }, 'This API is OpenAI-compatible and now lives on Wyv. Bot creation tools will arrive separately later.')
          );

          const tokensCardChildren = [];
          if (loadingTokens) {
            tokensCardChildren.push(el('div', { class: 'settings-card-copy' }, 'Loading API tokens...'));
          } else if (!canManageTokens) {
            tokensCardChildren.push(el('div', { class: 'settings-warning-copy' }, statusMessage || 'API token management is currently admin-only.'));
          } else {
            if (statusMessage) {
              tokensCardChildren.push(el('div', { class: 'settings-card-copy' }, statusMessage));
            }
            if (recentToken?.secret) {
              const recentSecretInput = el('input', {
                class: 'settings-input ai-token-secret-input',
                type: 'text',
                readOnly: 'true',
                value: recentToken.secret,
              });
              const copyRecentBtn = el('button', {
                class: 'btn-soft',
                type: 'button',
                onClick: () => copySecret(recentToken.secret),
              }, 'Copy secret');
              tokensCardChildren.push(
                el('div', { class: 'ai-token-highlight' },
                  el('div', { class: 'settings-meta-label' }, 'Latest token'),
                  el('div', { class: 'settings-card-copy' }, 'Copy this token now if you need it elsewhere. It remains available from your settings later.'),
                  el('div', { class: 'ai-token-secret-row' }, recentSecretInput, copyRecentBtn)
                )
              );
            }

            const createInput = el('input', {
              class: 'settings-input',
              type: 'text',
              value: createName,
              placeholder: 'Token name',
              maxlength: '120',
            });
            createInput.addEventListener('input', () => {
              createName = createInput.value;
            });

            const createBtn = el('button', {
              class: 'btn-confirm',
              type: 'button',
              disabled: busy,
              onClick: async () => {
                if (busy) return;
                setBusy(true);
                try {
                  const payload = await ai.apiTokens.create(createName.trim() || 'Wyvern OpenAI API Token');
                  recentToken = payload?.token || null;
                  createName = '';
                  statusMessage = 'Token created.';
                  await refreshTokens();
                } catch (err) {
                  statusMessage = err?.message || 'Could not create token.';
                  redraw();
                } finally {
                  setBusy(false);
                }
              }
            }, 'Create token');

            const revokeAllBtn = el('button', {
              class: 'btn-soft btn-danger-ghost',
              type: 'button',
              disabled: busy,
              onClick: async () => {
                if (busy) return;
                setBusy(true);
                try {
                  await ai.apiTokens.revokeAll();
                  recentToken = null;
                  statusMessage = 'All tokens revoked.';
                  await refreshTokens();
                } catch (err) {
                  statusMessage = err?.message || 'Could not revoke tokens.';
                  redraw();
                } finally {
                  setBusy(false);
                }
              }
            }, 'Revoke all');

            const rotateAllBtn = el('button', {
              class: 'btn-soft',
              type: 'button',
              disabled: busy,
              onClick: async () => {
                if (busy) return;
                setBusy(true);
                try {
                  const payload = await ai.apiTokens.rotateAll();
                  recentToken = Array.isArray(payload?.tokens) && payload.tokens.length ? payload.tokens[0] : null;
                  statusMessage = 'All tokens rotated.';
                  await refreshTokens();
                } catch (err) {
                  statusMessage = err?.message || 'Could not rotate tokens.';
                  redraw();
                } finally {
                  setBusy(false);
                }
              }
            }, 'Rotate all');

            tokensCardChildren.push(
              el('div', { class: 'settings-field' }, el('label', {}, 'Token Name'), createInput),
              el('div', { class: 'settings-inline-actions' }, createBtn, revokeAllBtn, rotateAllBtn),
            );

            if (tokens.length) {
              const tokenList = el('div', { class: 'ai-token-list' },
                ...tokens.map((token) => {
                  const secret = token.secret || '';
                  const tokenStatus = token.revoked_at ? 'Revoked' : 'Active';
                  const rotateBtn = el('button', {
                    class: 'btn-soft',
                    type: 'button',
                    disabled: busy,
                    onClick: async () => {
                      if (busy) return;
                      setBusy(true);
                      try {
                        const payload = await ai.apiTokens.rotate(token.id);
                        recentToken = payload?.token || null;
                        statusMessage = `Rotated ${token.name || 'token'}.`;
                        await refreshTokens();
                      } catch (err) {
                        statusMessage = err?.message || 'Could not rotate token.';
                        redraw();
                      } finally {
                        setBusy(false);
                      }
                    }
                  }, 'Rotate');

                  const revokeBtn = el('button', {
                    class: 'btn-soft btn-danger-ghost',
                    type: 'button',
                    disabled: busy || !!token.revoked_at,
                    onClick: async () => {
                      if (busy || token.revoked_at) return;
                      setBusy(true);
                      try {
                        await ai.apiTokens.revoke(token.id);
                        statusMessage = `Revoked ${token.name || 'token'}.`;
                        await refreshTokens();
                      } catch (err) {
                        statusMessage = err?.message || 'Could not revoke token.';
                        redraw();
                      } finally {
                        setBusy(false);
                      }
                    }
                  }, 'Revoke');

                  const secretInput = el('input', {
                    class: 'settings-input ai-token-secret-input',
                    type: 'text',
                    readOnly: 'true',
                    value: secret,
                  });

                  const copyBtn = el('button', {
                    class: 'btn-soft',
                    type: 'button',
                    onClick: () => copySecret(secret),
                  }, 'Copy');

                  return el('div', { class: `ai-token-row${token.revoked_at ? ' is-revoked' : ''}` },
                    el('div', { class: 'ai-token-main' },
                      el('div', { class: 'ai-token-name' }, token.name || 'API Token'),
                      el('div', { class: 'ai-token-meta' },
                        el('span', { class: `ai-token-pill${token.revoked_at ? ' is-revoked' : ''}` }, tokenStatus),
                        el('span', {}, token.created_at ? `Created ${fmtTime(token.created_at)}` : 'Created recently'),
                        token.last_used_at ? el('span', {}, `Used ${fmtTime(token.last_used_at)}`) : el('span', {}, 'Unused'),
                      ),
                      el('div', { class: 'ai-token-secret-row' }, secretInput, copyBtn),
                    ),
                    el('div', { class: 'settings-inline-actions ai-token-actions' }, rotateBtn, revokeBtn)
                  );
                })
              );
              tokensCardChildren.push(tokenList);
            } else {
              tokensCardChildren.push(el('div', { class: 'settings-card-copy' }, 'No API tokens yet. Create one to connect a client.'));
            }
          }

          const tokenCard = el('div', { class: 'settings-card' }, ...tokensCardChildren);

          container.append(
            el('div', { class: 'settings-section-kicker' }, 'API Access'),
            el('div', { class: 'settings-section-intro' }, 'Create and manage direct API tokens for lower-level integrations and automations.'),
            accessCard,
            tokenCard,
            buildChatSoonCard(),
          );
        };

        void refreshTokens();
        return container;
      }

      function renderForDevsSection() {
        content.append(
          el('div', { class: 'settings-section-kicker' }, 'Preview Features'),
          el('div', { class: 'settings-section-intro' }, 'Try upcoming Wyvern changes in this browser before they roll into the main experience.'),
          buildEdgeModeCard(),
        );
      }

      function renderSection() {
        content.innerHTML = '';
        Array.from(nav.querySelectorAll('.settings-hub-nav-btn')).forEach((button) => {
          button.classList.toggle('active', button.dataset.section === section);
        });
        if (section === 'connectors') content.appendChild(renderConnectorsSection());
        else if (section === 'api') content.appendChild(renderApiSection());
        else if (section === 'devs') renderForDevsSection();
        else renderAccountSection();
      }

      const sections = [
        { id: 'account', label: 'Account', icon: 'pencilSquare' },
        connectorsAllowed ? { id: 'connectors', label: 'Connectors', icon: 'link' } : null,
        { id: 'api', label: 'API', icon: 'key' },
        { id: 'devs', label: 'For Devs', icon: 'cog' },
      ].filter(Boolean);
      for (const item of sections) {
        nav.appendChild(
          el('button', {
            class: `settings-hub-nav-btn${section === item.id ? ' active' : ''}${item.disabled ? ' is-disabled' : ''}`,
            type: 'button',
            disabled: !!item.disabled,
            'data-section': item.id,
            onClick: () => {
              if (item.disabled) return;
              section = item.id;
              renderSection();
            },
          },
            heroIcon(item.icon, { size: 18 }),
            el('span', {}, item.label)
          )
        );
      }

      renderSection();
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
      });
    }

    function showServerSettingsHub(serverId, initialSection = 'overview') {
      const normalizedServerId = idKey(serverId) || null;
      if (!normalizedServerId) {
        toast('Select a server first', 'error');
        return;
      }

      let server = (store.state.servers || []).find((item) => idsEqual(item.id, normalizedServerId)) || null;
      if (!server) {
        toast('Server not found', 'error');
        return;
      }

      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal settings-hub-modal server-settings-hub-modal' });
      const shell = el('div', { class: 'settings-hub-shell server-settings-hub-shell' });
      const navTitle = el('div', { class: 'settings-hub-nav-title' }, server.name || 'Server Settings');
      const nav = el('div', { class: 'settings-hub-nav server-settings-hub-nav' }, navTitle);
      const panel = el('div', { class: 'settings-hub-panel server-settings-hub-panel' });
      const head = el('div', { class: 'settings-head server-settings-head' });
      const title = el('div', { class: 'settings-title' }, 'Server Settings');
      const subtitle = el('div', { class: 'settings-subtitle' }, 'Customize this server for members.');
      const content = el('div', { class: 'settings-hub-content server-settings-hub-content' });
      const footer = el('div', { class: 'settings-actions server-settings-footer' },
        el('button', { class: 'btn-ghost', type: 'button', onClick: () => overlay.remove() }, 'Close')
      );
      let section = initialSection === 'integrations' ? 'integrations' : 'overview';
      let iconUrl = (server.icon || '').trim();
      let detailsValue = String(server.description || '');
      let toggleValue = !!server.directory_opt_in;
      let draftName = server.name || '';
      let saving = false;
      let uploading = false;

      const fileInput = el('input', { type: 'file', accept: 'image/*' });
      fileInput.style.display = 'none';

      head.append(title, subtitle);
      panel.append(head, content, footer);
      shell.append(nav, panel);
      modal.appendChild(shell);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const updateHeader = () => {
        navTitle.textContent = server?.name || 'Server Settings';
        title.textContent = section === 'integrations' ? 'Server Integrations' : 'Server Settings';
        subtitle.textContent = section === 'integrations'
          ? 'Manage webhooks for this server.'
          : 'Customize this server for members.';
      };

      const updateServerState = (updatedServer) => {
        server = updatedServer || server;
        const nextServers = (store.state.servers || []).map((item) => idsEqual(item.id, server.id) ? server : item);
        store.set({ servers: nextServers });
        renderIconSidebar();
        renderChanSidebar();
        renderChatMain();
      };

      function renderOverviewSection() {
        content.innerHTML = '';
        const preview = el('div', { class: 'settings-icon-preview' });
        const nameInput = el('input', {
          class: 'settings-input',
          type: 'text',
          value: draftName,
          placeholder: 'Server Name',
          maxlength: '64',
        });
        const iconInput = el('input', {
          class: 'settings-input',
          type: 'text',
          value: iconUrl,
          placeholder: 'https://... or /media/...',
        });
        const detailsInput = el('textarea', {
          class: 'settings-textarea',
          maxlength: '512',
          placeholder: 'A short description for Server Directory.',
        }, detailsValue);
        detailsInput.value = detailsValue;
        const errorEl = el('div', { class: 'settings-error' });
        errorEl.style.display = 'none';
        const switchBtn = el('button', { class: `settings-switch${toggleValue ? ' on' : ''}`, type: 'button' });
        const saveBtn = el('button', { class: 'btn-confirm', type: 'button' }, 'Save Changes');

        const updatePreview = () => {
          preview.innerHTML = '';
          const currentName = (draftName || server?.name || 'S').trim();
          const fallback = currentName.slice(0, 2).toUpperCase() || 'S';
          const src = (iconUrl || '').trim();
          if (src) {
            const img = el('img', { src, alt: `${currentName || 'Server'} icon` });
            img.addEventListener('error', () => {
              preview.innerHTML = '';
              preview.appendChild(el('span', { class: 'settings-icon-fallback' }, fallback));
            });
            preview.appendChild(img);
          } else {
            preview.appendChild(el('span', { class: 'settings-icon-fallback' }, fallback));
          }
        };

        const setBusy = () => {
          saveBtn.disabled = saving || uploading;
          switchBtn.disabled = saving || uploading;
        };

        const setError = (message) => {
          errorEl.textContent = message || '';
          errorEl.style.display = message ? 'block' : 'none';
        };

        iconInput.addEventListener('input', () => {
          iconUrl = iconInput.value.trim();
          updatePreview();
        });
        nameInput.addEventListener('input', () => {
          draftName = nameInput.value;
          updatePreview();
        });
        detailsInput.addEventListener('input', () => {
          detailsValue = detailsInput.value;
        });
        switchBtn.addEventListener('click', () => {
          if (saving || uploading) return;
          toggleValue = !toggleValue;
          switchBtn.classList.toggle('on', toggleValue);
        });

        fileInput.onchange = async () => {
          const file = fileInput.files?.[0];
          fileInput.value = '';
          if (!file) return;
          setError('');
          uploading = true;
          setBusy();
          try {
            toast(`Uploading ${file.name}...`, 'info', 5000);
            const result = await uploads.upload(file);
            const uploadedUrl = (result?.url || result?.file_url || '').trim();
            if (!uploadedUrl) throw new Error('Upload response missing URL');
            iconUrl = uploadedUrl;
            iconInput.value = uploadedUrl;
            updatePreview();
            toast('Image uploaded', 'success');
          } catch (err) {
            setError(err?.message || 'Failed to upload image');
            toast(err?.message || 'Failed to upload image', 'error');
          } finally {
            uploading = false;
            setBusy();
          }
        };

        saveBtn.addEventListener('click', async () => {
          if (saving || uploading) return;
          if (!draftName.trim()) {
            setError('Server Name is required');
            return;
          }
          saving = true;
          setBusy();
          setError('');
          try {
            const updated = await servers.update(normalizedServerId, {
              name: draftName.trim(),
              description: detailsValue.trim() || null,
              icon: (iconUrl || '').trim() || null,
              directory_opt_in: !!toggleValue,
            });
            iconUrl = (updated?.icon || '').trim();
            detailsValue = String(updated?.description || '');
            toggleValue = !!updated?.directory_opt_in;
            draftName = updated?.name || draftName;
            updateServerState(updated);
            updateHeader();
            toast('Server updated', 'success');
            renderSection();
          } catch (err) {
            setError(err?.message || 'Failed to save server settings');
          } finally {
            saving = false;
            setBusy();
          }
        });

        updatePreview();

        content.append(
          el('div', { class: 'settings-section-kicker' }, 'Overview'),
          el('div', { class: 'settings-card' },
            el('div', { class: 'settings-icon-row' },
              preview,
              el('div', { class: 'settings-icon-meta' },
                el('div', { class: 'settings-icon-label' }, 'Server Icon'),
                el('div', { class: 'settings-icon-help' }, 'Upload a PNG/JPG/WebP or paste a URL.'),
                el('div', { class: 'settings-upload-actions' },
                  el('button', { class: 'btn-soft', type: 'button', onClick: () => fileInput.click() }, 'Upload Image'),
                  el('button', {
                    class: 'btn-soft btn-danger-ghost', type: 'button', onClick: () => {
                      iconUrl = '';
                      iconInput.value = '';
                      updatePreview();
                    }
                  }, 'Remove Icon')
                ),
                fileInput
              )
            ),
            el('div', { class: 'settings-field' }, el('label', {}, 'Server Icon URL'), iconInput),
            el('div', { class: 'settings-field' }, el('label', {}, 'Server Name'), nameInput),
            el('div', { class: 'settings-field' }, el('label', {}, 'Server Description'), detailsInput),
            el('div', { class: 'settings-toggle' },
              el('div', { class: 'settings-toggle-main' },
                el('div', { class: 'settings-toggle-title' }, 'Show In Server Directory'),
                el('div', { class: 'settings-toggle-help' }, 'Turn this on to let people discover and join this server.')
              ),
              switchBtn
            ),
            errorEl,
            el('div', { class: 'settings-inline-actions' }, saveBtn)
          )
        );
      }

      function renderIntegrationsSection() {
        content.innerHTML = '';
        content.append(
          el('div', { class: 'settings-section-kicker' }, 'Integrations'),
          buildServerIntegrationsSection(normalizedServerId)
        );
      }

      function renderSection() {
        updateHeader();
        Array.from(nav.querySelectorAll('.settings-hub-nav-btn')).forEach((button) => {
          button.classList.toggle('active', button.dataset.section === section);
        });
        if (section === 'integrations') renderIntegrationsSection();
        else renderOverviewSection();
      }

      const sections = [
        { id: 'overview', label: 'Overview', icon: 'pencilSquare' },
        { id: 'integrations', label: 'Integrations', icon: 'link' },
      ];
      for (const item of sections) {
        nav.appendChild(
          el('button', {
            class: `settings-hub-nav-btn${section === item.id ? ' active' : ''}`,
            type: 'button',
            'data-section': item.id,
            onClick: () => {
              section = item.id;
              renderSection();
            },
          },
            heroIcon(item.icon, { size: 18 }),
            el('span', {}, item.label)
          )
        );
      }

      renderSection();
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
      });
    }

    function showUserDirectoryModal({ onOpenDm }) {
      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal directory-modal' });
      const head = el('div', { class: 'directory-head' },
        el('div', { class: 'directory-title' }, 'User Directory'),
        el('div', { class: 'directory-subtitle' }, 'Find people who opted in and start a conversation.')
      );
      const body = el('div', { class: 'directory-body' });
      const search = el('input', {
        class: 'directory-search',
        type: 'text',
        placeholder: 'Search users...',
      });
      const list = el('div', { class: 'directory-list' }, el('div', { class: 'directory-empty' }, 'Loading users...'));
      const actions = el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', type: 'button', onClick: () => overlay.remove() }, 'Close')
      );
      body.append(search, list);
      modal.append(head, body, actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const state = { users: [] };
      const currentUserId = idKey(store.state.user?.id);

      function renderUsers() {
        const q = (search.value || '').trim().toLowerCase();
        const users = state.users.filter((user) => {
          const label = `${displayName(user)} ${user.username}#${user.discriminator} ${user.bio || ''} ${user.recommendation_reason || ''}`.toLowerCase();
          return !q || label.includes(q);
        });

        list.innerHTML = '';
        if (!users.length) {
          list.appendChild(el('div', { class: 'directory-empty' }, 'No users available right now.'));
          return;
        }

        for (const user of users) {
          const label = displayName(user);
          const card = el('div', { class: 'directory-card' });
          card.appendChild(avatarEl(label, 'member-av', 42, user.avatar));

          const main = el('div', { class: 'directory-main' },
            el('div', { class: 'directory-name' },
              label,
              user.recommendation_reason ? el('span', { class: 'dir-pill suggestion-pill', title: user.recommendation_reason }, 'Suggested') : null,
              el('span', { class: 'dir-pill' }, user.directory_opt_in ? 'Public' : 'Private'),
            ),
            el('div', { class: 'directory-meta' }, `${user.username}#${user.discriminator}`),
          );
          if (user.recommendation_reason) {
            main.appendChild(el('div', { class: 'directory-meta' }, user.recommendation_reason));
          }
          if (user.bio) {
            main.appendChild(el('div', { class: 'directory-bio' }, user.bio));
          }
          card.appendChild(main);

          const act = el('div', { class: 'directory-actions' });
          if (idsEqual(user.id, currentUserId)) {
            act.appendChild(el('button', { class: 'btn-soft', type: 'button', disabled: true }, 'You'));
          } else {
            act.appendChild(el('button', {
              class: 'btn-soft',
              type: 'button',
              onClick: async () => {
                try {
                  const dm = await dms.create(user.id);
                  if (!dm.participants?.length) {
                    dm.participants = [store.state.user, user].filter(Boolean);
                  }
                  await onOpenDm(dm);
                  overlay.remove();
                } catch (err) {
                  toast(err?.message || 'Could not open DM', 'error');
                }
              }
            }, 'Open DMs'));
          }
          card.appendChild(act);
          list.appendChild(card);
        }
      }

      search.addEventListener('input', renderUsers);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
      });

      (async () => {
        try {
          const usersFound = await users.directory({ recommended: directoryRecommendationsEnabled() });
          state.users = (usersFound || []).filter((user) => !!user?.id);
          for (const user of state.users) {
            if (user?.id) userCache.set(user.id, user);
          }
          renderUsers();
        } catch (err) {
          list.innerHTML = '';
          list.appendChild(el('div', { class: 'directory-empty' }, err?.message || 'Failed to load directory.'));
        }
      })();
    }

    function showServerDirectoryModal({ onSelectServer }) {
      const overlay = el('div', { class: 'modal-overlay' });
      const modal = el('div', { class: 'modal directory-modal' });
      const head = el('div', { class: 'directory-head' },
        el('div', { class: 'directory-title' }, 'Server Directory'),
        el('div', { class: 'directory-subtitle' }, 'Browse public servers and join instantly.')
      );
      const body = el('div', { class: 'directory-body' });
      const search = el('input', {
        class: 'directory-search',
        type: 'text',
        placeholder: 'Search servers...',
      });
      const list = el('div', { class: 'directory-list' }, el('div', { class: 'directory-empty' }, 'Loading servers...'));
      const actions = el('div', { class: 'modal-actions' },
        el('button', { class: 'btn-ghost', type: 'button', onClick: () => overlay.remove() }, 'Close')
      );
      body.append(search, list);
      modal.append(head, body, actions);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      const state = { entries: [] };

      function renderServers() {
        const q = (search.value || '').trim().toLowerCase();
        const entries = state.entries.filter((entry) => {
          const server = entry?.server || {};
          const label = `${server.name || ''} ${server.description || ''} ${entry.recommendation_reason || ''}`.toLowerCase();
          return !q || label.includes(q);
        });

        list.innerHTML = '';
        if (!entries.length) {
          list.appendChild(el('div', { class: 'directory-empty' }, 'No public servers found.'));
          return;
        }

        for (const entry of entries) {
          const server = entry.server || {};
          const label = server.name || 'Server';

          const card = el('div', { class: 'directory-card' });
          card.appendChild(avatarEl(label, 'member-av', 42, server.icon));

          const main = el('div', { class: 'directory-main' },
            el('div', { class: 'directory-name' },
              label,
              entry.recommendation_reason ? el('span', { class: 'dir-pill suggestion-pill', title: entry.recommendation_reason }, 'Suggested') : null,
              el('span', { class: 'dir-pill' }, `${entry.member_count || 0} Members`),
            ),
            el('div', { class: 'directory-meta' }, server.description || 'No description yet.'),
          );
          if (entry.recommendation_reason) {
            main.appendChild(el('div', { class: 'directory-meta' }, entry.recommendation_reason));
          }
          card.appendChild(main);

          const act = el('div', { class: 'directory-actions' });
          act.appendChild(el('button', {
            class: 'btn-soft',
            type: 'button',
            onClick: async () => {
              try {
                if (!entry.joined) {
                  await servers.join(server.id);
                  entry.joined = true;
                  const existing = store.state.servers || [];
                  if (!existing.some((srv) => idsEqual(srv.id, server.id))) {
                    store.set({ servers: [server, ...existing] });
                  }
                }
                await onSelectServer(server.id);
                overlay.remove();
              } catch (err) {
                toast(err?.message || 'Could not join server', 'error');
              }
            }
          }, entry.joined ? 'Open Server' : 'Join Server'));
          card.appendChild(act);

          list.appendChild(card);
        }
      }

      search.addEventListener('input', renderServers);
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) overlay.remove();
      });

      (async () => {
        try {
          state.entries = (await servers.directory({ recommended: directoryRecommendationsEnabled() })) || [];
          renderServers();
        } catch (err) {
          list.innerHTML = '';
          list.appendChild(el('div', { class: 'directory-empty' }, err?.message || 'Failed to load directory.'));
        }
      })();
    }

    // ─── WS status dot ────────────────────────────────────────────────────────────
    function wsDot(connected) {
      const d = el('div', { class: `ws-dot ${connected ? 'on' : 'off'}` });
      d.title = connected ? 'Connected' : 'Disconnected';
      return d;
    }

    function causeAdminError() {
      const error = new Error('Intentional admin test error');
      console.error(error);
      toast(error.message, 'error');
    }

    function adminCauseErrorButton() {
      return el('button', {
        class: 'topbar-btn admin-error-btn',
        type: 'button',
        title: 'Cause an intentional admin test error',
        onClick: (event) => {
          event.stopPropagation();
          causeAdminError();
        },
      }, heroIcon('xMark', { size: 12 }));
    }

    function activateModalFocusTrap(overlay, modal, initialFocus = null, onEscape = null) {
      const previousFocus = document.activeElement;
      const selectors = [
        'button:not([disabled])',
        'a[href]',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');
      const getFocusable = () => [...modal.querySelectorAll(selectors)].filter((node) => !node.hidden);
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onEscape?.();
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = getFocusable();
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      overlay.addEventListener('keydown', onKeyDown);
      setTimeout(() => {
        (initialFocus || getFocusable()[0] || modal).focus?.();
      }, 0);
      return () => {
        overlay.removeEventListener('keydown', onKeyDown);
        previousFocus?.focus?.();
      };
    }

    function showTextEntryModal({
      title,
      subtitle = '',
      label = 'Value',
      placeholder = '',
      initialValue = '',
      confirmLabel = 'Continue',
      onSubmit,
      multiline = false,
    }) {
      const overlay = el('div', { class: 'modal-overlay modal-overlay-soft' });
      const modal = el('div', { class: 'modal modal-small command-modal', role: 'dialog', 'aria-modal': 'true' });
      const field = multiline
        ? el('textarea', { class: 'modal-input modal-textarea', placeholder })
        : el('input', { class: 'modal-input', type: 'text', placeholder });
      field.value = initialValue;
      const errorEl = el('div', { class: 'auth-error' });
      errorEl.style.display = 'none';
      const cancelBtn = el('button', { class: 'btn-ghost', type: 'button' }, 'Cancel');
      const confirmBtn = el('button', { class: 'btn-confirm', type: 'button' }, confirmLabel);

      async function close() {
        cleanup?.();
        overlay.remove();
      }

      async function submit() {
        errorEl.style.display = 'none';
        try {
          await onSubmit?.((field.value || '').trim());
          await close();
        } catch (error) {
          errorEl.textContent = error?.message || 'Could not continue.';
          errorEl.style.display = 'block';
        }
      }

      cancelBtn.addEventListener('click', close);
      confirmBtn.addEventListener('click', submit);
      field.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !multiline && !event.shiftKey) {
          event.preventDefault();
          void submit();
        }
      });

      modal.append(
        el('div', { class: 'command-modal-head' },
          el('div', { class: 'command-modal-kicker' }, 'Wyvern Command Deck'),
          el('h3', { class: 'command-modal-title' }, title),
          subtitle ? el('p', { class: 'command-modal-copy' }, subtitle) : null,
        ),
        el('label', { class: 'command-modal-field' },
          el('span', { class: 'command-modal-label' }, label),
          field,
        ),
        errorEl,
        el('div', { class: 'modal-actions' }, cancelBtn, confirmBtn),
      );

      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      const cleanup = activateModalFocusTrap(overlay, modal, field, close);
      return { close };
    }


    function MessageList(channelId, { onReply = null, onViewportChange = null } = {}) {
      const root = el('div', { class: 'messages-scroll' });
      let msgList = [];
      let cursor = null;
      let hasMore = false;
      let hasRenderedOnce = false;
      const channelInfo = getChannelFromState(channelId);
      const channelServerId = channelInfo?.server_id || null;
      const isDmChannel = String(channelInfo?.type || '').toLowerCase() === 'dm';

      async function enrichAuthors(items) {
        const uniqueIds = [...new Set(
          (items || []).flatMap((msg) => [msg?.author_id, msg?.reply_to?.author_id]).filter(Boolean)
        )];
        await Promise.all(uniqueIds.map((id) => getUserCached(id)));
        for (const msg of (items || [])) {
          if (msg.author_id && userCache.has(msg.author_id)) {
            msg.author = { ...(msg.author || {}), ...userCache.get(msg.author_id) };
          }
          if (msg.reply_to && msg.reply_to.author_id && userCache.has(msg.reply_to.author_id)) {
            msg.reply_to.author = { ...(msg.reply_to.author || {}), ...userCache.get(msg.reply_to.author_id) };
          }
        }
      }

      function normalizeReactions(items) {
        if (!Array.isArray(items)) return [];
        return items
          .map((reaction) => {
            if (!reaction?.emoji) return null;
            const users = [...new Set((reaction.users || []).map(idKey).filter(Boolean))];
            const count = Number(reaction.count || users.length || 0);
            return {
              emoji: reaction.emoji,
              users,
              count: count || users.length || 1,
            };
          })
          .filter(Boolean)
          .sort((a, b) => (b.count - a.count) || a.emoji.localeCompare(b.emoji));
      }

      function hydrateMessageState(message, previous = null) {
        if (!message) return previous;
        const next = { ...(previous || {}), ...message };
        next.attachments = Array.isArray(next.attachments) ? next.attachments : [];
        next.is_nsfw = Boolean(next.is_nsfw ?? previous?.is_nsfw);
        next.reactions = normalizeReactions(next.reactions ?? previous?.reactions ?? []);

        if (previous?.author && !next.author) {
          next.author = previous.author;
        }

        if (next.reply_to) {
          next.reply_to = { ...(previous?.reply_to || {}), ...next.reply_to };
          next.reply_to.attachments = Array.isArray(next.reply_to.attachments) ? next.reply_to.attachments : [];
          next.reply_to.is_nsfw = Boolean(next.reply_to.is_nsfw ?? previous?.reply_to?.is_nsfw);
          if (previous?.reply_to?.author && !next.reply_to.author) {
            next.reply_to.author = previous.reply_to.author;
          }
        }

        return next;
      }

      function empty() {
        const activeChannel = getChannelFromState(channelId);
        const channelLabel = activeChannel?.type === 'dm'
          ? (dmDisplayName(activeChannel) || 'Direct Message')
          : `#${activeChannel?.name || 'channel'}`;
        return el('div', { class: 'empty-channel' },
          el('div', { class: 'empty-icon empty-icon-brand' }, el('img', { src: WYVERN_SECTION_LOGO_URL, alt: 'Wyvern' })),
          el('div', { class: 'empty-kicker' }, activeChannel?.type === 'dm' ? 'Direct Conversation' : 'Channel Ready'),
          el('h4', {}, channelLabel),
          el('p', {}, activeChannel?.description || 'Nothing has landed here yet. Start the thread and set the tone for this space.'),
          el('div', { class: 'empty-cta' }, 'Be the first to post')
        );
      }

      async function load(initial = false) {
        if (initial) {
          root.innerHTML = '';
          root.appendChild(spinner());
        }
        try {
          const data = await msgApi.list(channelId, initial ? null : cursor);
          const arr = (Array.isArray(data) ? data : (data.items || data.messages || [])).map((msg) => hydrateMessageState(msg));
          const nextCursor = Array.isArray(data) ? null : (data.next_cursor ?? null);
          await enrichAuthors(arr);
          if (initial) {
            msgList = arr;
            cursor = nextCursor;
            hasMore = nextCursor !== null;
          } else {
            msgList = [...arr, ...msgList];
            cursor = nextCursor;
            hasMore = nextCursor !== null;
          }
          store.set({
            messages: {
              ...(store.state.messages || {}),
              [idKey(channelId)]: [...msgList],
            },
          });
          if (msgList.length) {
            rememberLatestMessage(msgList[msgList.length - 1]);
          }
          renderAll();
          if (initial && msgList.length && idsEqual(store.state.activeChannelId, channelId)) {
            void markChannelRead(channelId, msgList[msgList.length - 1]?.id || null);
          }
        } catch (e) {
          if (initial) {
            root.innerHTML = '';
            root.appendChild(empty());
          }
        }
      }

      function bindMessageLinkClicks(container) {
        for (const linkEl of container.querySelectorAll('a.msg-link')) {
          linkEl.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const targetUrl = linkEl.getAttribute('data-url') || linkEl.getAttribute('href') || '';
            showLinkOpenOptions(targetUrl);
          });
        }
      }

      function shouldMergeWithPrevious(previous, current) {
        if (!previous || !current) return false;
        if (!idsEqual(previous.author_id, current.author_id)) return false;
        if (!sameDay(previous.created_at, current.created_at)) return false;
        if (previous.reply_to_id || current.reply_to_id) return false;
        const delta = Math.abs(new Date(current.created_at) - new Date(previous.created_at));
        return delta < 5 * 60 * 1000;
      }

      function jumpToMessage(messageId) {
        const target = root.querySelector(`[data-message-id="${messageId}"]`);
        if (!target) {
          toast('The original message is outside the loaded history.', 'info');
          return;
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('flash');
        void target.offsetWidth;
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1200);
      }

      function createReplyPreview(message) {
        if (!message) return null;
        const replyAuthor = message.author || userCache.get(message.author_id) || { username: 'Unknown', id: message.author_id };
        const replyLabel = displayName(replyAuthor);
        return el('button', {
          class: 'msg-reply-preview',
          type: 'button',
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            jumpToMessage(message.id);
          },
        },
          avatarEl(replyLabel, 'msg-reply-avatar', 16, replyAuthor.avatar),
          el('div', { class: 'msg-reply-line' },
            el('span', { class: 'msg-reply-author' }, replyLabel),
            el('span', { class: 'msg-reply-snippet' }, messagePreviewText(message, 72)),
          )
        );
      }

      async function syncReactionState(payload) {
        const updatedMessage = payload?.message || null;
        if (updatedMessage?.id) {
          const updated = root.updateMessage(updatedMessage);
          if (updated) return;
        }
        await load(true);
      }

      function msgRow(msg, { merged = false } = {}) {
        const me = store.state.user;
        const isMe = me && idsEqual(msg.author_id, me.id);
        const hideSensitiveContent = messageContentHidden(msg);
        const author = msg.webhook_name
          ? { username: msg.webhook_name, display_name: msg.webhook_name, avatar: msg.webhook_avatar }
          : (msg.author || userCache.get(msg.author_id) || { username: 'Unknown', id: msg.author_id });
        const authorLabel = displayName(author);

        const avatarNode = merged
          ? el('div', { class: 'msg-avatar-gap' })
          : avatarEl(authorLabel, 'msg-av', 40, author.avatar);

        const metaEl = el('div', { class: 'msg-meta' });
        const nameEl = el('span', {
          class: `msg-author${isMe ? ' is-self' : ''}`,
          onClick: () => { },
        }, authorLabel);
        const timeEl = el('span', { class: 'msg-time' }, fmtTime(msg.created_at));
        metaEl.append(nameEl, timeEl);
        if (communityToolsEnabled() && msg.is_pinned) {
          metaEl.appendChild(el('span', { class: 'msg-pin-badge' }, heroIcon('pin', { size: 12 }), el('span', {}, 'Pinned')));
        }
        if (msg.is_nsfw) {
          metaEl.appendChild(el('span', { class: 'mini-pill' }, hideSensitiveContent ? 'NSFW Hidden' : 'NSFW'));
        }

        const normalizedAttachments = hideSensitiveContent
          ? []
          : (msg.attachments || [])
            .map(toAttachmentObj)
            .filter(Boolean);
        if (!hideSensitiveContent) {
          const extractedUrls = extractMediaUrls(msg.content || '');
          for (const mediaUrl of extractedUrls) {
            if (!normalizedAttachments.find((item) => item.url === mediaUrl)) {
              normalizedAttachments.push(toAttachmentObj(mediaUrl));
            }
          }
        }

        let contentText = hideSensitiveContent
          ? 'Sensitive message hidden. Enable 18+ NSFW access in Settings to view it.'
          : (msg.content || '');
        for (const att of normalizedAttachments) {
          contentText = contentText.replace(att.url, '').replace(/\s{2,}/g, ' ').trim();
        }

        const body = el('div', { class: 'msg-body' });
        const replyPreviewEl = createReplyPreview(msg.reply_to);
        if (replyPreviewEl) body.appendChild(replyPreviewEl);
        if (!merged) body.appendChild(metaEl);

        const textEl = trustedHtmlEl('div', { class: 'msg-text' }, renderContent(contentText));
        bindMessageLinkClicks(textEl);
        if (msg.edited_at) textEl.appendChild(el('span', { class: 'edited-tag' }, '(edited)'));
        body.appendChild(textEl);

        if (!hideSensitiveContent) {
          const embedLinks = extractHttpLinks(contentText)
            .filter(shouldRenderLinkEmbed)
            .slice(0, 3);
          for (const url of embedLinks) {
            const embed = createLinkEmbed(url);
            if (embed) body.appendChild(embed);
          }
        }

        if (normalizedAttachments.length) {
          for (const att of normalizedAttachments) {
            const kind = mediaKind(att.url);
            let contentNode;
            if (kind === 'image') {
              contentNode = el('a', {
                href: att.url,
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  showLinkOpenOptions(att.url);
                },
              },
                el('img', { class: 'msg-media-image', src: att.url, alt: att.filename || 'image', loading: 'lazy' })
              );
            } else if (kind === 'video') {
              contentNode = el('video', { class: 'msg-media-video', src: att.url, controls: true });
            } else if (kind === 'audio') {
              contentNode = el('audio', { class: 'msg-media-audio', src: att.url, controls: true });
            } else {
              contentNode = el('a', {
                href: att.url,
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  showLinkOpenOptions(att.url);
                },
              },
                el('span', { class: 'icon-with-text' },
                  heroIcon('paperClip', { size: 16 }),
                  el('span', {}, att.filename || 'Attachment'),
                )
              );
            }
            body.appendChild(el('div', { class: 'msg-attachment' }, contentNode));
          }
        }

        if (msg.reactions?.length) {
          const reactRow = el('div', { class: 'msg-reactions' });
          for (const reaction of msg.reactions) {
            const reactedByMe = (reaction.users || []).some((userId) => idsEqual(userId, me?.id));
            const chip = el('div', {
              class: `reaction-chip${reactedByMe ? ' mine' : ''}`,
              onClick: async () => {
                try {
                  const payload = reactedByMe
                    ? await msgApi.removeReaction(msg.id, reaction.emoji)
                    : await msgApi.addReaction(msg.id, reaction.emoji);
                  await syncReactionState(payload);
                } catch (error) {
                  toast(error?.message || 'Could not update reaction', 'error');
                }
              },
            },
              el('span', {}, reaction.emoji),
              el('span', { class: 'rc-count' }, String(reaction.count || reaction.users?.length || 1))
            );
            reactRow.appendChild(chip);
          }
          body.appendChild(reactRow);
        }

        const actions = el('div', { class: 'msg-actions' });
        actions.appendChild(
          el('button', {
            class: 'act-btn',
            title: 'Reply',
            onClick: (event) => {
              event.stopPropagation();
              onReply?.(msg);
            },
          }, heroIcon('arrowUturnLeft', { size: 16 }))
        );
        actions.appendChild(
          el('button', { class: 'act-btn', title: 'React', onClick: () => quickReact(msg) }, heroIcon('faceSmile', { size: 16 }))
        );
        if (communityToolsEnabled()) {
          actions.appendChild(
            el('button', {
              class: `act-btn${msg.bookmarked_by_me ? ' active' : ''}`,
              title: msg.bookmarked_by_me ? 'Remove bookmark' : 'Save message',
              onClick: async () => {
                try {
                  const payload = msg.bookmarked_by_me ? await msgApi.unbookmark(msg.id) : await msgApi.bookmark(msg.id);
                  const updated = payload?.message || payload?.data?.message || payload?.data || null;
                  if (updated?.id) {
                    root.updateMessage(updated);
                  } else {
                    await load(true);
                  }
                } catch (error) {
                  toast(error?.message || 'Could not update bookmark', 'error');
                }
              },
            }, heroIcon('bookmark', { size: 16 }))
          );

          const canPin = isDmChannel || isMe || (!isDmChannel && (canModerateServer(channelServerId) || idsEqual(store.state.user?.id, msg.author_id)));
          if (canPin) {
            actions.appendChild(
              el('button', {
                class: `act-btn${msg.is_pinned ? ' active' : ''}`,
                title: msg.is_pinned ? 'Unpin message' : 'Pin message',
                onClick: async () => {
                  try {
                    const payload = msg.is_pinned ? await msgApi.unpin(msg.id) : await msgApi.pin(msg.id);
                    const updated = payload?.data || payload?.message || payload || null;
                    if (updated?.id) {
                      root.updateMessage(updated);
                    } else {
                      await load(true);
                    }
                  } catch (error) {
                    toast(error?.message || 'Could not update pin', 'error');
                  }
                },
              }, heroIcon('pin', { size: 16 }))
            );
          }
        }

        if (isMe) {
          const editBtn = el('button', { class: 'act-btn', title: 'Edit', onClick: () => startEdit(msg, body) }, heroIcon('pencilSquare', { size: 16 }));
          const delBtn = el('button', {
            class: 'act-btn danger', title: 'Delete', onClick: async () => {
              await msgApi.delete(msg.id);
              msgList = msgList.filter((item) => !idsEqual(item.id, msg.id));
              renderAll();
            }
          }, heroIcon('trash', { size: 16 }));
          actions.append(editBtn, delBtn);
        }

        return el('div', {
          class: `msg-group${merged ? ' is-merged' : ''}${msg.pending ? ' is-pending' : ''}`,
          'data-message-id': String(msg.id),
        }, avatarNode, body, actions);
      }

      function notifyViewportState() {
        const distanceFromBottom = root.scrollHeight - root.scrollTop - root.clientHeight;
        const atBottom = distanceFromBottom < 80;
        onViewportChange?.({ atBottom });
        if (atBottom && idsEqual(store.state.activeChannelId, channelId) && msgList.length) {
          void markChannelRead(channelId, msgList[msgList.length - 1]?.id || null);
        }
      }

      function renderAll() {
        const scrollBottom = root.scrollHeight - root.scrollTop - root.clientHeight;
        root.innerHTML = '';
        const lane = el('div', { class: 'messages-lane' });

        if (hasMore) {
          const loadBtn = el(
            'button',
            { class: 'load-more-btn', onClick: () => load(false) },
            heroIcon('arrowUp', { size: 14 }),
            el('span', {}, 'Load earlier messages'),
          );
          lane.appendChild(loadBtn);
        }

        if (!msgList.length) {
          lane.appendChild(empty());
          root.appendChild(lane);
          return;
        }

        let lastDate = null;
        let previousMessage = null;
        for (const msg of msgList) {
          if (!sameDay(lastDate, msg.created_at)) {
            lane.appendChild(el('div', { class: 'msg-day-divider' }, fmtDate(msg.created_at)));
            lastDate = msg.created_at;
            previousMessage = null;
          }
          lane.appendChild(msgRow(msg, { merged: shouldMergeWithPrevious(previousMessage, msg) }));
          previousMessage = msg;
        }

        root.appendChild(lane);
        const shouldSnapToBottom = !hasRenderedOnce || scrollBottom < 80;
        hasRenderedOnce = true;
        if (shouldSnapToBottom) {
          const snapToBottom = () => {
            root.scrollTop = root.scrollHeight;
            window.requestAnimationFrame(() => {
              root.scrollTop = root.scrollHeight;
              notifyViewportState();
            });
          };
          window.requestAnimationFrame(snapToBottom);
        } else {
          notifyViewportState();
        }
      }

      function jumpToBottom() {
        const snapToBottom = () => {
          root.scrollTop = root.scrollHeight;
          window.requestAnimationFrame(() => {
            root.scrollTop = root.scrollHeight;
          });
        };
        window.requestAnimationFrame(snapToBottom);
      }

      function quickReact(msg) {
        const currentUserId = idKey(store.state.user?.id);
        let closePicker = null;

        async function applyReaction(emoji) {
          const normalized = String(emoji || '').trim();
          if (!normalized) {
            toast('Pick or paste an emoji to react with', 'error');
            return;
          }
          try {
            const existing = (msg.reactions || []).find((reaction) => String(reaction.emoji || '') === normalized);
            const shouldRemove = (existing?.users || []).some((userId) => idsEqual(userId, currentUserId));
            const payload = shouldRemove
              ? await msgApi.removeReaction(msg.id, normalized)
              : await msgApi.addReaction(msg.id, normalized);
            await syncReactionState(payload);
          } catch (error) {
            toast(error?.message || 'Could not update reaction', 'error');
          }
        }

        const overlay = el('div', { class: 'modal-overlay' });
        const modal = el('div', { class: 'modal' });
        modal.style.maxWidth = '460px';

        const heading = el('h3', {}, 'React with emoji');
        const copy = el('div', {
          style: 'margin-top: 10px; color: var(--text-muted); font-size: 13px; line-height: 1.6;',
        }, 'Type or paste any emoji, or tap a quick reaction below.');

        const emojiInput = el('input', {
          class: 'modal-input',
          type: 'text',
          placeholder: 'Any emoji',
        });
        emojiInput.maxLength = 64;
        emojiInput.setAttribute('inputmode', 'text');
        emojiInput.style.fontSize = '30px';
        emojiInput.style.textAlign = 'center';
        emojiInput.style.letterSpacing = '0.12em';

        const quickRow = el('div', {
          style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;justify-content:center;',
        });
        const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🐉', '🎉', '👏', '💯', '🤖', '✨'];
        for (const emoji of quickEmojis) {
          quickRow.appendChild(el('button', {
            type: 'button',
            style: 'min-width:48px;height:44px;padding:0 10px;border-radius:10px;background:rgba(255,255,255,0.05);font-size:22px;cursor:pointer;transition:transform 0.12s ease, background 0.12s ease;',
            onMouseEnter: (event) => { event.currentTarget.style.background = 'rgba(255,255,255,0.09)'; event.currentTarget.style.transform = 'translateY(-1px)'; },
            onMouseLeave: (event) => { event.currentTarget.style.background = 'rgba(255,255,255,0.05)'; event.currentTarget.style.transform = 'translateY(0)'; },
            onClick: async (event) => {
              event.stopPropagation();
              closePicker?.();
              await applyReaction(emoji);
            },
          }, emoji));
        }

        const actions = el('div', { class: 'modal-actions' });
        const cancelBtn = el('button', {
          class: 'btn-ghost',
          type: 'button',
          onClick: () => closePicker?.(),
        }, 'Cancel');
        const reactBtn = el('button', {
          class: 'btn-confirm',
          type: 'button',
          onClick: async () => {
            const emoji = (emojiInput.value || '').trim();
            closePicker?.();
            await applyReaction(emoji);
          },
        }, 'React');
        actions.append(cancelBtn, reactBtn);

        modal.append(heading, copy, emojiInput, quickRow, actions);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const closeOnBackdrop = (event) => {
          if (event.target === overlay) {
            closePicker?.();
          }
        };
        const onEsc = (event) => {
          if (event.key === 'Escape') {
            closePicker?.();
          }
          if (event.key === 'Enter' && document.activeElement === emojiInput) {
            event.preventDefault();
            reactBtn.click();
          }
        };

        closePicker = () => {
          document.removeEventListener('click', closeOnBackdrop);
          document.removeEventListener('keydown', onEsc);
          overlay.remove();
        };

        overlay.addEventListener('click', closeOnBackdrop);
        document.addEventListener('keydown', onEsc);
        setTimeout(() => emojiInput.focus(), 30);
      }

      function startEdit(msg, body) {
        const original = msg.content;
        const inp = el('input', { type: 'text' });
        inp.style.cssText = 'background:#2a2a2a;border:1px solid #00c8ff;border-radius:6px;padding:6px 10px;width:100%;color:#fff;font-size:14px;';
        inp.value = original;
        const oldText = body.querySelector('.msg-text');
        body.replaceChild(inp, oldText);
        inp.focus();

        inp.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            const newContent = inp.value.trim();
            if (!newContent || newContent === original) {
              body.replaceChild(oldText, inp);
              return;
            }
            try {
              await msgApi.edit(msg.id, newContent);
              msg.content = newContent;
              msg.edited_at = new Date().toISOString();
              const newText = trustedHtmlEl('div', { class: 'msg-text' }, renderContent(newContent));
              bindMessageLinkClicks(newText);
              newText.appendChild(el('span', { class: 'edited-tag' }, '(edited)'));
              body.replaceChild(newText, inp);
            } catch {
              body.replaceChild(oldText, inp);
            }
          }
          if (e.key === 'Escape') {
            body.replaceChild(oldText, inp);
          }
        });
      }

      root.addMessage = (msg) => {
        const next = hydrateMessageState(msg);
        const idx = msgList.findIndex((item) => idsEqual(item.id, next?.id));
        if (idx >= 0) {
          msgList[idx] = hydrateMessageState(next, msgList[idx]);
        } else {
          msgList.push(next);
        }
        rememberLatestMessage(next);
        store.set({
          messages: {
            ...(store.state.messages || {}),
            [idKey(channelId)]: [...msgList],
          },
        });
        renderAll();
        enrichAuthors([next]).then(() => renderAll());
      };

      root.updateMessage = (msg) => {
        const idx = msgList.findIndex((item) => idsEqual(item.id, msg.id));
        if (idx >= 0) {
          const next = hydrateMessageState(msg, msgList[idx]);
          msgList[idx] = next;
          rememberLatestMessage(msgList[msgList.length - 1] || next);
          store.set({
            messages: {
              ...(store.state.messages || {}),
              [idKey(channelId)]: [...msgList],
            },
          });
          renderAll();
          enrichAuthors([next]).then(() => renderAll());
          return true;
        }
        return false;
      };

      root.deleteMessage = (id) => {
        msgList = msgList.filter((msg) => !idsEqual(msg.id, id));
        renderAll();
      };

      root.addReaction = (payload) => { void syncReactionState(payload); };
      root.refreshAuthors = () => {
        void enrichAuthors(msgList).then(() => renderAll());
      };
      root.jumpToMessage = jumpToMessage;
      root.jumpToBottom = jumpToBottom;
      root.isNearBottom = () => (root.scrollHeight - root.scrollTop - root.clientHeight) < 80;
      root.replaceTemporaryMessage = (temporaryId, replacement) => {
        const index = msgList.findIndex((item) => idsEqual(item.id, temporaryId));
        if (index < 0) return false;
        msgList[index] = hydrateMessageState(replacement, msgList[index]);
        rememberLatestMessage(msgList[msgList.length - 1] || replacement);
        renderAll();
        return true;
      };

      root.addEventListener('scroll', notifyViewportState);

      load(true);
      return root;
    }

    function authStoryPanel() {
      return el('aside', { class: 'auth-story-panel' },
        el('div', { class: 'auth-story-kicker' }, 'Wyvern Command Deck'),
        el('h2', { class: 'auth-story-title' }, 'Build spaces that feel alive, organized, and unmistakably yours.'),
        el('p', { class: 'auth-story-copy' }, 'Chat, voice, community search, workspace drafting, and live experiments all ride in one sharper shell.'),
        el('div', { class: 'auth-story-grid' },
          el('div', { class: 'auth-story-card' },
            el('span', { class: 'auth-story-card-label' }, 'Realtime'),
            el('strong', {}, 'Voice, typing, presence, and unread state stay in sync.')
          ),
          el('div', { class: 'auth-story-card' },
            el('span', { class: 'auth-story-card-label' }, 'Community'),
            el('strong', {}, 'Servers, DMs, workspace tools, and discovery live side by side.')
          ),
          el('div', { class: 'auth-story-card' },
            el('span', { class: 'auth-story-card-label' }, 'Experimental'),
            el('strong', {}, 'Edge variants let the product evolve in public with real feedback.')
          ),
        ),
      );
    }


    function AuthView() {
      let mode = 'login'; // 'login' | 'register'

      const root = el('div', { class: 'auth-view' });
      const bg = el('div', { class: 'auth-bg' });
      const card = el('div', { class: 'auth-card' });

      root.append(bg);
      if (isUiA()) {
        root.appendChild(authStoryPanel());
      }
      root.appendChild(card);

      function logo() {
        return el('div', { class: 'auth-logo' },
          el('div', { class: 'auth-logo-icon' },
            el('img', { src: WYVERN_LOGO_URL, alt: 'Wyvern logo' })
          ),
          el('span', { class: 'auth-logo-text' }, 'WYVERN')
        );
      }

      function render() {
        card.innerHTML = '';
        const errEl = el('div', { class: 'auth-error' });
        errEl.style.display = 'none';
        const legal = legalConfig();

        const title = el('div', { class: 'auth-title' }, mode === 'login' ? 'Sign In' : 'Create Account');
        const introCopy = mode === 'register'
          ? el('div', { class: 'auth-copy' }, 'Creating an account requires a versioned clickwrap agreement. Review the current Terms of Service and Privacy Policy before continuing.')
          : null;

        const fields = [];
        if (mode === 'register') {
          const displayNameField = mkField('Display Name', 'text', 'displayName', 'Your public display name');
          const usernameField = mkField('Username', 'text', 'username', 'cooluser123');
          fields.push(displayNameField, usernameField);
        }
        const emailField = mkField('Email', 'email', 'email', 'you@example.com');
        const passField = mkField('Password', 'password', 'password', '••••••••');
        fields.push(emailField, passField);
        const legalLinks = mode === 'register'
          ? el('div', { class: 'auth-inline-links' },
            legalLink('Terms of Service', legal.terms_url),
            legalLink('Privacy Policy', legal.privacy_url)
          )
          : null;
        const legalCheckbox = mode === 'register'
          ? mkLegalCheckbox(legal, 'auth-register-legal')
          : null;

        const submitBtn = el('button', {
          class: 'btn-primary',
          onClick: handleSubmit
        }, mode === 'login' ? 'Sign In' : 'Create Account');

        const switchEl = el('div', { class: 'auth-switch' });
        if (mode === 'login') {
          switchEl.append(
            document.createTextNode("Don't have an account?"),
            el('button', { onClick: () => { mode = 'register'; render(); } }, 'Register')
          );
        } else {
          switchEl.append(
            document.createTextNode('Already have an account?'),
            el('button', { onClick: () => { mode = 'login'; render(); } }, 'Sign In')
          );
        }

        card.append(logo(), title);
        if (introCopy) card.appendChild(introCopy);
        card.appendChild(errEl);
        fields.forEach((field) => card.appendChild(field));
        if (legalLinks) card.appendChild(legalLinks);
        if (legalCheckbox) card.appendChild(legalCheckbox);
        card.append(submitBtn, switchEl);

        async function handleSubmit() {
          errEl.style.display = 'none';
          submitBtn.disabled = true;
          submitBtn.textContent = '...';

          const email = card.querySelector('[data-field="email"]')?.value.trim();
          const password = card.querySelector('[data-field="password"]')?.value;
          const username = card.querySelector('[data-field="username"]')?.value.trim();
          const displayName = card.querySelector('[data-field="displayName"]')?.value.trim();
          const acceptedLegal = !!card.querySelector('[data-field="acceptedLegal"]')?.checked;

          try {
            if (mode === 'login') {
              await auth.login(email, password);
            } else {
              if (!acceptedLegal) {
                throw new Error('Please accept the Terms of Service and Privacy Policy to create an account.');
              }
              await auth.register(username, email, password, displayName || null, {
                acceptedLegal: true,
                termsVersion: legal.terms_version,
                privacyVersion: legal.privacy_version,
              });
              await auth.login(email, password);
            }
            const me = await enrichUserPresence(await users.me());
            store.set({ user: me, isAuthed: true, view: resolvePostAuthView(me) });
            if (await maybeLaunchWyvFromQuery()) return;
            if (shouldAutoOpenChangelog()) {
              showChangelogModal();
            }
            void loadChangelog();
          } catch (err) {
            errEl.textContent = err?.message || 'Something went wrong. Please try again.';
            errEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = mode === 'login' ? 'Sign In' : 'Create Account';
          }
        }

        // allow enter to submit
        card.querySelectorAll('input').forEach(inp => {
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });
        });
      }

      function mkField(label, type, key, placeholder) {
        const wrap = el('div', { class: 'auth-field' });
        const lbl = el('label', {}, label);
        const input = el('input', { type, placeholder });
        input.setAttribute('data-field', key);
        wrap.append(lbl, input);
        return wrap;
      }

      function legalLink(label, href) {
        return el('a', { href, target: '_blank', rel: 'noreferrer' }, label);
      }

      function mkLegalCheckbox(legal, inputId) {
        const checkbox = el('input', { id: inputId, type: 'checkbox' });
        checkbox.setAttribute('data-field', 'acceptedLegal');
        return el('label', { class: 'auth-check', for: inputId },
          checkbox,
          el('span', { class: 'auth-check-copy' },
            'I agree to the ',
            legalLink('Terms of Service', legal.terms_url),
            ' and ',
            legalLink('Privacy Policy', legal.privacy_url),
            `. This acceptance applies to versions ${legal.terms_version} and ${legal.privacy_version}.`
          )
        );
      }

      render();
      return root;
    }

    function LegalAcceptanceView() {
      const legal = legalConfig();
      const root = el('div', { class: 'auth-view' });
      const bg = el('div', { class: 'auth-bg' });
      const card = el('div', { class: 'auth-card legal-card' });
      const errEl = el('div', { class: 'auth-error' });
      errEl.style.display = 'none';
      const consentId = 'legal-reaccept-checkbox';
      const consentCheckbox = el('input', { id: consentId, type: 'checkbox' });
      const acceptBtn = el('button', { class: 'btn-primary', type: 'button', disabled: true }, 'Accept and Continue');
      const signOutBtn = el('button', { class: 'btn-ghost', type: 'button' }, 'Sign Out');

      consentCheckbox.addEventListener('change', () => {
        acceptBtn.disabled = !consentCheckbox.checked;
      });

      acceptBtn.addEventListener('click', async () => {
        errEl.style.display = 'none';
        acceptBtn.disabled = true;
        acceptBtn.textContent = 'Saving...';
        try {
          await users.acceptLegal({
            accepted_legal: true,
            terms_version: legal.terms_version,
            privacy_version: legal.privacy_version,
          });
          const me = await enrichUserPresence(await users.me());
          store.set({ user: me, isAuthed: true, view: resolvePostAuthView(me) });
          if (await maybeLaunchWyvFromQuery()) return;
        } catch (error) {
          errEl.textContent = error?.message || 'Could not update your legal acceptance.';
          errEl.style.display = 'block';
          acceptBtn.disabled = !consentCheckbox.checked;
          acceptBtn.textContent = 'Accept and Continue';
        }
      });

      signOutBtn.addEventListener('click', () => {
        void signOutUser();
      });

      card.append(
        el('div', { class: 'auth-logo' },
          el('div', { class: 'auth-logo-icon' },
            el('img', { src: WYVERN_LOGO_URL, alt: 'Wyvern logo' })
          ),
          el('span', { class: 'auth-logo-text' }, 'WYVERN')
        ),
        el('div', { class: 'auth-title' }, 'Legal Update Required'),
        el('div', { class: 'auth-copy' }, 'Your account is signed in, but Wyvern needs you to accept the latest Terms of Service and Privacy Policy before you can continue using the app.'),
        errEl,
        el('div', { class: 'auth-meta-grid' },
          el('div', { class: 'auth-meta-card' },
            el('div', { class: 'auth-meta-label' }, 'Terms Version'),
            el('div', { class: 'auth-meta-value' }, legal.terms_version)
          ),
          el('div', { class: 'auth-meta-card' },
            el('div', { class: 'auth-meta-label' }, 'Privacy Version'),
            el('div', { class: 'auth-meta-value' }, legal.privacy_version)
          ),
          el('div', { class: 'auth-meta-card' },
            el('div', { class: 'auth-meta-label' }, 'Effective Date'),
            el('div', { class: 'auth-meta-value' }, legal.effective_date_label)
          )
        ),
        el('div', { class: 'auth-inline-links' },
          el('a', { href: legal.terms_url, target: '_blank', rel: 'noreferrer' }, 'Open Terms of Service'),
          el('a', { href: legal.privacy_url, target: '_blank', rel: 'noreferrer' }, 'Open Privacy Policy')
        ),
        el('label', { class: 'auth-check', for: consentId },
          consentCheckbox,
          el('span', { class: 'auth-check-copy' },
            `I have reviewed and accept the current Terms of Service and Privacy Policy for ${legal.operator_name}. Legal notices and privacy matters should be sent to `,
            el('a', { href: `mailto:${legal.legal_contact_email}` }, legal.legal_contact_email),
            '. General support requests should go to ',
            el('a', { href: `mailto:${legal.support_contact_email}` }, legal.support_contact_email),
            '.'
          )
        ),
        el('div', { class: 'auth-actions' }, acceptBtn, signOutBtn)
      );

      root.append(bg);
      if (isUiA()) {
        root.appendChild(authStoryPanel());
      }
      root.appendChild(card);
      return root;
    }

    function buildEdgeIframeSrc(cacheBust = Date.now()) {
      const url = new URL(`${edgePathPrefix()}/`, window.location.origin);
      url.searchParams.set('embedded', '1');
      url.searchParams.set('edgeParentOrigin', window.location.origin);
      url.searchParams.set('edgeBridgeVersion', String(runtimeConfig?.bridge_schema_version || 1));
      url.searchParams.set('v', String(cacheBust));
      return url.toString();
    }

    function EdgeShellView() {
      const root = el('div', { class: 'edge-shell' });

      if (!edgeModeCanBoot()) {
        root.append(
          el('div', { class: 'edge-shell-empty' },
            el('div', { class: 'edge-shell-empty-card' },
              el('div', { class: 'edge-shell-kicker' }, 'Edge Unavailable'),
              el('div', { class: 'edge-shell-title' }, 'This stable host does not have the `/edge` route enabled.'),
              el('div', { class: 'settings-card-copy' }, 'Return to stable mode and verify `EDGE_MODE_ENABLED` on the backend, then restart it so the `/edge` route is exposed.')
            )
          )
        );
        return root;
      }

      const bar = el('div', { class: 'edge-shell-bar' });
      const copy = el('div', { class: 'edge-shell-copy' },
        el('div', { class: 'edge-shell-kicker' }, 'Edge UI Lab'),
        el('div', { class: 'edge-shell-title' }, 'Compare the Edge interfaces'),
        el('div', { class: 'edge-shell-subtitle' }, `Target: ${edgeTargetLabel()} • Stable keeps control while you test Original, UI A, and UI B`),
      );
      const actions = el('div', { class: 'edge-shell-actions' });
      const frameWrap = el('div', { class: 'edge-shell-frame-wrap' });
      const frame = el('iframe', {
        class: 'edge-shell-frame',
        title: 'Wyvern Edge Mode',
        src: buildEdgeIframeSrc(),
        referrerpolicy: 'origin',
        allow: 'clipboard-read; clipboard-write; microphone; camera',
      });
      frameWrap.appendChild(frame);
      bar.append(copy, actions);
      root.append(bar, frameWrap);

      const reloadFrame = () => {
        frame.src = buildEdgeIframeSrc();
      };

      const handleMessage = async (event) => {
        const edgeOrigin = window.location.origin;
        if (event.origin !== edgeOrigin || event.source !== frame.contentWindow) return;
        if (event.data?.type !== 'wyvern.edge.ready') return;
        if (!token.access) return;
        try {
          const handoff = await auth.edgeHandoff();
          frame.contentWindow?.postMessage({
            type: 'wyvern.edge.handoff',
            grant: handoff?.grant || handoff?.data?.grant || handoff?.handoff,
          }, edgeOrigin);
        } catch (err) {
          console.error('Edge handoff failed', err);
        }
      };

      const handleDisableMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'wyvern.edge.disable') return;
        setEdgeModeEnabled(false);
        store.set({ view: 'app' });
      };

      window.addEventListener('message', handleMessage);
      window.addEventListener('message', handleDisableMessage);

      actions.append(
        el('button', {
          class: 'btn-soft',
          type: 'button',
          onClick: disableEdgeMode,
        }, 'Return to Stable'),
        el('button', { class: 'btn-confirm', type: 'button', onClick: reloadFrame }, 'Reload Edge'),
      );

      root.cleanup = () => {
        window.removeEventListener('message', handleMessage);
        window.removeEventListener('message', handleDisableMessage);
      };
      return root;
    }


    let socket = null;
    let msgListEl = null;

    function AppView() {
      const root = el('div', { class: 'app-layout' });
      root.dataset.shellVariant = shellRefreshEnabled() ? 'modern' : 'legacy';
      if (currentUiVariantKey()) root.dataset.uiVariant = currentUiVariantKey();

      // ── Icon Sidebar ──────────────────────────────────────────────────────────
      const iconSidebar = el('div', { class: 'icon-sidebar' });

      // ── Channel Sidebar ───────────────────────────────────────────────────────
      const chanSidebar = el('div', { class: 'channel-sidebar' });

      // ── Chat Main ─────────────────────────────────────────────────────────────
      const chatMain = el('div', { class: 'chat-main' });

      // ── Member Sidebar ────────────────────────────────────────────────────────
      const memberSidebar = el('div', { class: 'member-sidebar' });

      const overlay = el('div', {
        class: 'mobile-sidebar-overlay',
        onClick: () => store.set({ mobileSidebarOpen: false, memberSidebarOpen: false })
      });

      root.append(overlay, iconSidebar, chanSidebar, chatMain, memberSidebar);
      const edgeUiLabLink = createEdgeUiLabLink();
      if (edgeUiLabLink) root.appendChild(edgeUiLabLink);
      let composerEl = null;
      let statusMenuEl = null;
      let statusMenuCleanup = null;

      function closeStatusMenu() {
        if (statusMenuCleanup) {
          document.removeEventListener('mousedown', statusMenuCleanup);
          statusMenuCleanup = null;
        }
        if (!statusMenuEl) return;
        statusMenuEl.remove();
        statusMenuEl = null;
      }

      function applyPresenceLocally(userId, status) {
        const normalizedUserId = idKey(userId);
        if (!normalizedUserId) return;
        mergeUserLocally({ id: normalizedUserId, presence: status }, { presence: status });
      }

      function showPresenceMenu(anchorEl) {
        closeStatusMenu();
        const rect = anchorEl.getBoundingClientRect();
        const menu = el('div', { class: 'status-menu' });
        statusMenuEl = menu;

        for (const option of PRESENCE_OPTIONS) {
          const isActive = (store.state.user?.presence || 'online') === option.value;
          const btn = el('button', {
            class: `status-option${isActive ? ' active' : ''}`,
            type: 'button',
            onClick: async () => {
              try {
                await users.setPresence(option.value);
                applyPresenceLocally(store.state.user?.id, option.value);
                closeStatusMenu();
              } catch (err) {
                toast(err?.message || 'Could not update status', 'error');
              }
            },
          },
            el('span', { class: `status-dot-inline s-${option.value}` }),
            el('span', { class: 'status-option-copy' },
              el('span', { class: 'status-option-label' }, option.label),
              el('span', { class: 'status-option-sub' }, option.value === 'dnd' ? 'Pause interruptions' : 'Show your availability'),
            )
          );
          menu.appendChild(btn);
        }

        document.body.appendChild(menu);
        const menuRect = menu.getBoundingClientRect();
        const top = Math.min(
          window.innerHeight - menuRect.height - 12,
          Math.max(12, rect.top - 8 - menuRect.height),
        );
        const left = Math.min(
          window.innerWidth - menuRect.width - 12,
          Math.max(12, rect.left - 72),
        );
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;

        const handleOutside = (event) => {
          if (!menu.contains(event.target) && event.target !== anchorEl) {
            closeStatusMenu();
          }
        };

        statusMenuCleanup = handleOutside;
        setTimeout(() => document.addEventListener('mousedown', handleOutside), 0);
      }

      function refreshVoiceSpeakingUI() {
        const activeVoiceView = chatMain.querySelector('.voice-view');
        if (!activeVoiceView) return;

        for (const row of activeVoiceView.querySelectorAll('.voice-user[data-user-id]')) {
          const userId = idKey(row.getAttribute('data-user-id'));
          const speaking = voiceState.speakingUsers.has(userId);
          row.classList.toggle('speaking', speaking);
          const indicator = row.querySelector('.voice-speaking-indicator');
          if (indicator) indicator.hidden = !speaking;
        }
      }

      async function ensureVoiceAudioContext() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!voiceState.audioContext || voiceState.audioContext.state === 'closed') {
          voiceState.audioContext = new AudioCtx();
        }
        if (voiceState.audioContext.state === 'suspended') {
          await voiceState.audioContext.resume().catch(() => { });
        }
        return voiceState.audioContext;
      }

      function setVoiceSpeaking(userId, speaking) {
        const normalized = idKey(userId);
        if (!normalized) return;
        const currentlySpeaking = voiceState.speakingUsers.has(normalized);
        if (speaking === currentlySpeaking) return;
        if (speaking) voiceState.speakingUsers.add(normalized);
        else voiceState.speakingUsers.delete(normalized);
        refreshVoiceSpeakingUI();
      }

      function stopVoiceMeterPolling() {
        if (!voiceState.speakingPollTimer) return;
        clearInterval(voiceState.speakingPollTimer);
        voiceState.speakingPollTimer = null;
      }

      function startVoiceMeterPolling() {
        if (voiceState.speakingPollTimer || !voiceState.speakingMeters.size) return;
        voiceState.speakingPollTimer = setInterval(() => {
          for (const [userId, meter] of voiceState.speakingMeters.entries()) {
            if (!meter?.analyser || !meter?.data) continue;
            if (idsEqual(userId, store.state.user?.id) && voiceState.muted) {
              meter.hotTicks = 0;
              meter.coolTicks = 10;
              setVoiceSpeaking(userId, false);
              continue;
            }

            meter.analyser.getByteTimeDomainData(meter.data);
            let sum = 0;
            for (const sample of meter.data) {
              const centered = (sample - 128) / 128;
              sum += centered * centered;
            }
            const rms = Math.sqrt(sum / meter.data.length);
            const threshold = idsEqual(userId, store.state.user?.id) ? 0.045 : 0.03;

            if (rms >= threshold) {
              meter.hotTicks = (meter.hotTicks || 0) + 1;
              meter.coolTicks = 0;
              if (meter.hotTicks >= 2) setVoiceSpeaking(userId, true);
            } else {
              meter.coolTicks = (meter.coolTicks || 0) + 1;
              meter.hotTicks = 0;
              if (meter.coolTicks >= 4) setVoiceSpeaking(userId, false);
            }
          }
        }, 150);
      }

      function removeVoiceMeter(userId) {
        const normalized = idKey(userId);
        const meter = voiceState.speakingMeters.get(normalized);
        if (!meter) return;
        try { meter.source.disconnect(); } catch { }
        try { meter.analyser.disconnect(); } catch { }
        voiceState.speakingMeters.delete(normalized);
        setVoiceSpeaking(normalized, false);
        if (!voiceState.speakingMeters.size) stopVoiceMeterPolling();
      }

      async function attachVoiceMeter(userId, stream) {
        const normalized = idKey(userId);
        if (!normalized || !stream) return;
        const context = await ensureVoiceAudioContext();
        if (!context) return;

        removeVoiceMeter(normalized);

        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);

        voiceState.speakingMeters.set(normalized, {
          source,
          analyser,
          data: new Uint8Array(analyser.fftSize),
          hotTicks: 0,
          coolTicks: 0,
        });
        startVoiceMeterPolling();
      }

      function supportsVoiceCalling() {
        return !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
      }

      function allKnownChannels() {
        const serverChans = Object.values(store.state.channels || {}).flat();
        const dmsKnown = store.state.dmList || [];
        return [...serverChans, ...dmsKnown];
      }

      function findChannelById(channelId) {
        const target = idKey(channelId);
        if (!target) return null;
        return allKnownChannels().find((item) => idsEqual(item?.id, target)) || null;
      }

      function findServerIdForChannel(channelId) {
        const target = idKey(channelId);
        if (!target) return null;
        for (const [serverId, chans] of Object.entries(store.state.channels || {})) {
          if ((chans || []).some((item) => idsEqual(item?.id, target))) {
            return idKey(serverId);
          }
        }
        return null;
      }

      function resolveChannelLabel(channelId) {
        const channel = findChannelById(channelId);
        if (!channel) return 'Channel';
        if (channel.type === 'dm') return dmDisplayName(channel);
        if (channel.type === 'voice') return `Voice: ${channel.name || 'channel'}`;
        return `#${channel.name || 'channel'}`;
      }

      let communityHubController = null;
      let communityHubReturnState = null;

      function openCommunityHubPage(initialTab = 'discover') {
        if (!communityToolsEnabled()) {
          toast('Community tools are not enabled on this channel yet', 'error');
          return;
        }
        if (store.state.sidebarMode === 'community') {
          store.set({ communityHubTab: initialTab || 'discover' });
          renderChatMain();
          return;
        }
        communityHubReturnState = {
          sidebarMode: store.state.sidebarMode,
          activeServerId: store.state.activeServerId,
          activeChannelId: store.state.activeChannelId,
          activeDmId: store.state.activeDmId,
          communityHubTab: store.state.communityHubTab || 'discover',
        };
        store.set({
          sidebarMode: 'community',
          activeServerId: store.state.activeServerId,
          activeChannelId: store.state.activeChannelId,
          activeDmId: store.state.activeDmId,
          communityHubTab: initialTab || 'discover',
          communityHubWorkspaceTargetId: store.state.communityHubWorkspaceTargetId || store.state.activeChannelId || null,
          communityHubWorkspaceTargetKind: store.state.communityHubWorkspaceTargetKind || (findChannelById(store.state.activeChannelId)?.type === 'dm' ? 'dm' : 'server'),
          communityHubWorkspaceVisibility: store.state.communityHubWorkspaceVisibility || 'public',
          communityHubPinsTargetId: store.state.communityHubPinsTargetId || store.state.activeChannelId || null,
          communityHubPinsTargetKind: store.state.communityHubPinsTargetKind || (findChannelById(store.state.activeChannelId)?.type === 'dm' ? 'dm' : 'server'),
        });
        renderIconSidebar();
        renderChanSidebar();
        renderMemberSidebar();
        renderChatMain();
      }

      function closeCommunityHubPage() {
        const restore = communityHubReturnState || {
          sidebarMode: 'servers',
          activeServerId: null,
          activeChannelId: null,
          activeDmId: null,
          communityHubTab: 'discover',
        };
        communityHubReturnState = null;
        store.set({
          sidebarMode: restore.sidebarMode || 'servers',
          activeServerId: restore.activeServerId || null,
          activeChannelId: restore.activeChannelId || null,
          activeDmId: restore.activeDmId || null,
          communityHubTab: restore.communityHubTab || 'discover',
        });
        renderIconSidebar();
        renderChanSidebar();
        renderMemberSidebar();
        renderChatMain();
      }

      function showCommunityHub(initialTab = 'discover', options = {}) {
        if (!communityToolsEnabled()) {
          toast('Community tools are not enabled on this channel yet', 'error');
          return;
        }

        const embedded = !!options.embedded;
        const mount = options.mount || null;
        const activeChannel = findChannelById(store.state.activeChannelId);
        const currentServerId = idKey(store.state.activeServerId || activeChannel?.server_id) || null;
        const availableTabs = ['discover', 'search', 'pins', 'bookmarks', 'workspace', 'activity'];
        const requestedTab = embedded ? (store.state.communityHubTab || initialTab) : initialTab;
        let currentTab = availableTabs.includes(requestedTab) ? requestedTab : 'discover';
        let searchResults = [];
        let pinnedMessages = [];
        let bookmarkEntries = [];
        let activityEntries = [];
        let workspaceDoc = null;
        let workspaceDraft = null;
        let discoverUsers = [];
        let discoverServers = [];
        let workspaceTimer = null;
        let workspaceDirty = false;
        let workspaceTargetChannelId = idKey(store.state.communityHubWorkspaceTargetId || activeChannel?.id || store.state.activeChannelId) || null;
        let workspaceTargetKind = String(store.state.communityHubWorkspaceTargetKind || (findChannelById(workspaceTargetChannelId)?.type === 'dm' ? 'dm' : 'server')).toLowerCase() === 'dm' ? 'dm' : 'server';
        let workspaceVisibility = String(store.state.communityHubWorkspaceVisibility || 'public').toLowerCase() === 'private' ? 'private' : 'public';
        let workspaceTargetsHydrated = false;
        let workspaceTargetsLoading = false;
        let workspaceEditorElement = null;
        let workspaceRefreshSuppressedUntil = 0;
        let pinsTargetChannelId = idKey(store.state.communityHubPinsTargetId || activeChannel?.id || store.state.activeChannelId) || null;
        let pinsTargetKind = String(store.state.communityHubPinsTargetKind || (findChannelById(pinsTargetChannelId)?.type === 'dm' ? 'dm' : 'server')).toLowerCase() === 'dm' ? 'dm' : 'server';
        let searchDraft = {
          q: '',
          scope: activeChannel?.type === 'dm' ? 'channel' : 'channel',
          authorQuery: '',
          authorId: null,
          pinned: false,
          attachments: false,
          reactions: false,
          createdAfter: '',
          createdBefore: '',
        };
        let loading = false;

        const overlay = embedded ? null : el('div', { class: 'modal-overlay' });
        const modal = el('div', { class: embedded ? 'community-hub-inline' : 'modal community-hub-modal' });
        const shell = el('div', { class: 'community-hub-shell' });
        const nav = el('div', { class: 'community-hub-nav' });
        const panel = el('div', { class: 'community-hub-panel' });
        const header = el('div', { class: 'community-hub-header' });
        const title = el('div', { class: 'community-hub-title' }, 'Community Hub');
        const subtitle = el('div', { class: 'community-hub-subtitle' });
        const status = el('div', { class: 'community-hub-status' });
        const content = el('div', { class: 'community-hub-content' });
        const footer = el('div', { class: 'community-hub-footer' },
          el('button', { class: 'btn-ghost', type: 'button', onClick: () => closeHub() }, embedded ? 'Back' : 'Close')
        );

        const tabs = [
          { id: 'discover', label: 'Discover', icon: 'userGroup' },
          { id: 'search', label: 'Search', icon: 'magnifyingGlass' },
          { id: 'pins', label: 'Pins', icon: 'pin' },
          { id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
          { id: 'workspace', label: 'Workspace', icon: 'pencilSquare' },
          { id: 'activity', label: 'Activity', icon: 'clock' },
        ];
        const isCommunityHubMounted = () => (embedded ? !!mount?.isConnected : !!overlay?.isConnected);

        const onCommunityHubEscape = (event) => {
          if (event.key !== 'Escape') return;
          if (!isCommunityHubMounted()) return;
          closeHub();
        };

        function setStatus(text) {
          status.textContent = text || '';
        }

        function clearWorkspaceTimer() {
          if (workspaceTimer) {
            clearTimeout(workspaceTimer);
            workspaceTimer = null;
          }
        }

        function persistWorkspaceSelectionState() {
          const nextTargetId = idKey(workspaceTargetChannelId) || null;
          const nextTargetKind = workspaceTargetKind === 'dm' ? 'dm' : 'server';
          const nextVisibility = workspaceVisibility === 'private' ? 'private' : 'public';
          if (
            idsEqual(store.state.communityHubWorkspaceTargetId, nextTargetId)
            && String(store.state.communityHubWorkspaceTargetKind || 'server') === nextTargetKind
            && String(store.state.communityHubWorkspaceVisibility || 'public') === nextVisibility
          ) {
            return;
          }
          store.set({
            communityHubWorkspaceTargetId: nextTargetId,
            communityHubWorkspaceTargetKind: nextTargetKind,
            communityHubWorkspaceVisibility: nextVisibility,
          });
        }

        function persistPinsSelectionState() {
          const nextTargetId = idKey(pinsTargetChannelId) || null;
          const nextTargetKind = pinsTargetKind === 'dm' ? 'dm' : 'server';
          if (
            idsEqual(store.state.communityHubPinsTargetId, nextTargetId)
            && String(store.state.communityHubPinsTargetKind || 'server') === nextTargetKind
          ) {
            return;
          }
          store.set({
            communityHubPinsTargetId: nextTargetId,
            communityHubPinsTargetKind: nextTargetKind,
          });
        }

        const WORKSPACE_LANGUAGE_OPTIONS = [
          ['plaintext', 'Plain Text'],
          ['python', 'Python'],
          ['javascript', 'JavaScript'],
          ['typescript', 'TypeScript'],
          ['html', 'HTML'],
          ['css', 'CSS'],
          ['json', 'JSON'],
          ['sql', 'SQL'],
          ['markdown', 'Markdown'],
        ];

        function normalizeWorkspaceLanguage(value) {
          const normalized = String(value || 'plaintext').trim().toLowerCase();
          return WORKSPACE_LANGUAGE_OPTIONS.some(([id]) => id === normalized) ? normalized : 'plaintext';
        }

        function listWorkspaceDmTargets(targets = listWorkspaceTargets()) {
          return (targets || []).filter((item) => item.kind === 'dm');
        }

        function listWorkspaceServerScopes(targets = listWorkspaceTargets()) {
          const scopes = [];
          const seen = new Set();
          for (const item of targets || []) {
            const serverId = idKey(item.serverId);
            if (item.kind !== 'server' || !serverId) continue;
            if (seen.has(serverId)) continue;
            seen.add(serverId);
            scopes.push({
              serverId,
              label: item.group || 'Server',
              channels: (targets || []).filter((target) => target.kind === 'server' && idsEqual(target.serverId, serverId)),
            });
          }
          return scopes;
        }

        function workspaceTargetModeForTarget(target) {
          return target?.kind === 'dm' ? 'dm' : 'server';
        }

        function listPinsTargets(targets = listWorkspaceTargets()) {
          return (targets || []).filter((item) => item.kind === 'dm' || String(item.channel?.type || '').toLowerCase() === 'text');
        }

        function listPinsDmTargets(targets = listPinsTargets()) {
          return (targets || []).filter((item) => item.kind === 'dm');
        }

        function listPinsServerScopes(targets = listPinsTargets()) {
          const scopes = [];
          const seen = new Set();
          for (const item of targets || []) {
            const serverId = idKey(item.serverId);
            if (item.kind !== 'server' || !serverId) continue;
            if (seen.has(serverId)) continue;
            seen.add(serverId);
            scopes.push({
              serverId,
              label: item.group || 'Server',
              channels: (targets || []).filter((target) => target.kind === 'server' && idsEqual(target.serverId, serverId)),
            });
          }
          return scopes;
        }

        function pinsTargetModeForTarget(target) {
          return target?.kind === 'dm' ? 'dm' : 'server';
        }

        function buildWorkspaceDraftFromSource(source, channel) {
          const fallbackTitle = `${resolveChannelLabel(channel?.id || workspaceTargetChannelId || 0) || channel?.name || 'Workspace'} Workspace`;
          return {
            title: source?.title || fallbackTitle,
            mode: source?.mode === 'code' ? 'code' : 'writing',
            language: normalizeWorkspaceLanguage(source?.language),
            content: source?.content || '',
          };
        }

        function escapeWorkspaceHtml(value) {
          return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        }

        function highlightWorkspaceCode(value, language) {
          const source = String(value || '');
          if (!source.trim()) return '';
          let working = escapeWorkspaceHtml(source);
          const placeholders = [];
          const stash = (html) => {
            const token = `__WYV_WS_TOKEN_${placeholders.length}__`;
            placeholders.push(html);
            return token;
          };
          const stashRegex = (regex, className) => {
            working = working.replace(regex, (match) => stash(`<span class="${className}">${match}</span>`));
          };

          const normalizedLanguage = normalizeWorkspaceLanguage(language);
          if (normalizedLanguage === 'html') {
            stashRegex(/(&lt;!--[\s\S]*?--&gt;)/g, 'community-syntax-comment');
            stashRegex(/(&lt;\/?[a-zA-Z][^&]*?&gt;)/g, 'community-syntax-tag');
          } else if (normalizedLanguage === 'python') {
            stashRegex(/(#[^\n]*)/g, 'community-syntax-comment');
          } else if (normalizedLanguage === 'sql') {
            stashRegex(/(--[^\n]*)/g, 'community-syntax-comment');
          } else if (normalizedLanguage !== 'json' && normalizedLanguage !== 'markdown') {
            stashRegex(/(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g, 'community-syntax-comment');
          }

          stashRegex(/(`[^`\n]*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, 'community-syntax-string');

          const keywordSets = {
            python: /\b(def|class|return|if|elif|else|import|from|for|while|try|except|with|as|lambda|pass|yield|True|False|None|async|await)\b/g,
            javascript: /\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|import|export|from|async|await|try|catch|throw|extends)\b/g,
            typescript: /\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|import|export|from|async|await|try|catch|throw|extends|interface|type|enum|implements|public|private|readonly)\b/g,
            css: /\b(display|position|color|background|font|grid|flex|padding|margin|border|width|height|gap|align-items|justify-content|transition)\b/g,
            sql: /\b(SELECT|FROM|WHERE|INSERT|INTO|UPDATE|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|ORDER|BY|LIMIT|VALUES|AS|AND|OR|NOT|NULL|CREATE|TABLE)\b/gi,
            markdown: /(^|\s)(#{1,6}|\*|-|\d+\.)/gm,
          };
          const keywordRegex = keywordSets[normalizedLanguage];
          if (keywordRegex) {
            working = working.replace(keywordRegex, (match) => `<span class="community-syntax-keyword">${match}</span>`);
          }
          if (normalizedLanguage === 'json') {
            working = working.replace(/("(?:\\.|[^"\\])*")(?=\s*:)/g, '<span class="community-syntax-key">$1</span>');
            working = working.replace(/\b(true|false|null)\b/g, '<span class="community-syntax-boolean">$1</span>');
          }
          working = working.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="community-syntax-number">$1</span>');

          placeholders.forEach((html, index) => {
            working = working.replaceAll(`__WYV_WS_TOKEN_${index}__`, html);
          });
          return working;
        }

        function setWorkspacePreview(previewEl, contentValue, languageValue) {
          if (!previewEl) return;
          const highlighted = highlightWorkspaceCode(contentValue, languageValue);
          previewEl.classList.toggle('is-empty', !highlighted);
          previewEl.innerHTML = highlighted || 'Code preview will appear here as you type.';
        }

        function setWorkspaceEditorMirror(mirrorEl, contentValue, languageValue) {
          if (!mirrorEl) return;
          const highlighted = highlightWorkspaceCode(contentValue, languageValue);
          mirrorEl.classList.toggle('is-empty', !highlighted);
          mirrorEl.innerHTML = highlighted || 'Type code here to see live highlighting.';
        }

        function syncWorkspaceEditorMirror(editorEl, mirrorEl) {
          if (!editorEl || !mirrorEl) return;
          mirrorEl.scrollTop = editorEl.scrollTop;
          mirrorEl.scrollLeft = editorEl.scrollLeft;
        }

        function formatActivityMetadata(metadata) {
          if (!metadata || typeof metadata !== 'object') return 'No additional metadata';
          const parts = [];
          if (metadata.title) parts.push(`Title: ${metadata.title}`);
          if (metadata.mode) parts.push(`Mode: ${String(metadata.mode).toUpperCase()}`);
          if (metadata.language) parts.push(`Language: ${String(metadata.language).toUpperCase()}`);
          if (metadata.visibility) parts.push(`Visibility: ${String(metadata.visibility).toUpperCase()}`);
          if (metadata.channel_id) parts.push(`Channel: ${resolveChannelLabel(metadata.channel_id)}`);
          if (metadata.server_id) parts.push(`Server: ${metadata.server_id}`);
          if (metadata.target_id && !parts.some((part) => part.includes(String(metadata.target_id)))) parts.push(`Target: ${metadata.target_id}`);
          const remaining = Object.entries(metadata)
            .filter(([key]) => !['title', 'mode', 'language', 'visibility', 'channel_id', 'server_id', 'target_id'].includes(key))
            .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
          return [...parts, ...remaining].join(' • ') || 'No additional metadata';
        }

        function updateWorkspaceDraftState(nextDraft) {
          workspaceDraft = {
            title: nextDraft.title || '',
            mode: nextDraft.mode === 'code' ? 'code' : 'writing',
            language: normalizeWorkspaceLanguage(nextDraft.language),
            content: nextDraft.content || '',
          };
          workspaceDirty = true;
        }

        function indentWorkspaceSelection(input) {
          const value = input.value || '';
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? 0;
          if (start === end) {
            input.setRangeText('\t', start, end, 'end');
            return;
          }
          const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
          const selected = value.slice(lineStart, end);
          const updated = selected.replace(/(^|\n)/g, '$1\t');
          input.setRangeText(updated, lineStart, end, 'preserve');
          input.selectionStart = start + 1;
          input.selectionEnd = end + (updated.length - selected.length);
        }

        function outdentWorkspaceSelection(input) {
          const value = input.value || '';
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? 0;
          const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
          const selected = value.slice(lineStart, end);
          let removedBeforeStart = 0;
          let removedTotal = 0;
          const updated = selected.replace(/(^|\n)(\t| {1,2})/g, (match, prefix, indent, offset) => {
            if (offset < Math.max(0, start - lineStart)) removedBeforeStart += indent.length;
            removedTotal += indent.length;
            return prefix;
          });
          if (updated === selected) return;
          input.setRangeText(updated, lineStart, end, 'preserve');
          input.selectionStart = Math.max(lineStart, start - removedBeforeStart);
          input.selectionEnd = Math.max(input.selectionStart, end - removedTotal);
        }

        function joinWorkspaceLineBackward(input) {
          const value = input.value || '';
          const start = input.selectionStart ?? 0;
          const end = input.selectionEnd ?? 0;
          if (start !== end || start <= 0) return false;
          const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
          if (start !== lineStart) return false;
          input.setRangeText('', start - 1, end, 'end');
          return true;
        }

        function listWorkspaceTargets() {
          const targets = [];
          for (const dm of (store.state.dmList || [])) {
            const dmId = idKey(dm?.id);
            if (!dmId) continue;
            targets.push({
              id: dmId,
              label: dmDisplayName(dm),
              kind: 'dm',
              group: 'Direct Messages',
              channel: dm,
            });
          }
          for (const server of (store.state.servers || [])) {
            const serverId = idKey(server.id);
            const serverChannels = ((store.state.channels?.[server.id] || []).filter((channel) => {
              const type = String(channel?.type || '').toLowerCase();
              return type === 'text' || type === 'voice';
            }));
            for (const channel of serverChannels) {
              const channelId = idKey(channel.id);
              if (!channelId) continue;
              targets.push({
                id: channelId,
                label: resolveChannelLabel(channel.id),
                kind: 'server',
                group: server.name || 'Server',
                serverId,
                channel,
              });
            }
          }
          return targets;
        }

        async function ensureWorkspaceTargetsLoaded() {
          if (workspaceTargetsHydrated || workspaceTargetsLoading) return;
          workspaceTargetsLoading = true;
          try {
            const nextChannels = { ...(store.state.channels || {}) };
            let changed = false;
            for (const server of (store.state.servers || [])) {
              if (nextChannels[server.id]) continue;
              try {
                nextChannels[server.id] = await channels.list(server.id) || [];
                changed = true;
              } catch { }
            }
            workspaceTargetsHydrated = true;
            if (changed) {
              store.set({ channels: nextChannels });
            }
          } finally {
            workspaceTargetsLoading = false;
          }
        }

        function resolveWorkspaceTargetChannel() {
          const targets = listWorkspaceTargets();
          if (!targets.length) {
            workspaceTargetChannelId = null;
            workspaceTargetKind = 'server';
            persistWorkspaceSelectionState();
            return null;
          }
          const requestedKind = String(store.state.communityHubWorkspaceTargetKind || workspaceTargetKind || 'server').toLowerCase() === 'dm' ? 'dm' : 'server';
          let preferredTargets = targets.filter((item) => workspaceTargetModeForTarget(item) === requestedKind);
          if (!preferredTargets.length) {
            preferredTargets = targets;
          }
          const requestedTargetId = idKey(workspaceTargetChannelId || activeChannel?.id || store.state.activeChannelId) || null;
          const resolvedTarget = preferredTargets.find((item) => idsEqual(item.id, requestedTargetId)) || preferredTargets[0] || targets[0];
          workspaceTargetChannelId = idKey(resolvedTarget?.id) || null;
          workspaceTargetKind = workspaceTargetModeForTarget(resolvedTarget);
          persistWorkspaceSelectionState();
          return findChannelById(workspaceTargetChannelId) || resolvedTarget?.channel || null;
        }

        function resolvePinnedTargetChannel() {
          const targets = listPinsTargets();
          if (!targets.length) {
            pinsTargetChannelId = null;
            pinsTargetKind = 'server';
            persistPinsSelectionState();
            return null;
          }
          const requestedKind = String(store.state.communityHubPinsTargetKind || pinsTargetKind || 'server').toLowerCase() === 'dm' ? 'dm' : 'server';
          let preferredTargets = targets.filter((item) => pinsTargetModeForTarget(item) === requestedKind);
          if (!preferredTargets.length) {
            preferredTargets = targets;
          }
          const requestedTargetId = idKey(pinsTargetChannelId || activeChannel?.id || store.state.activeChannelId) || null;
          const resolvedTarget = preferredTargets.find((item) => idsEqual(item.id, requestedTargetId)) || preferredTargets[0] || targets[0];
          pinsTargetChannelId = idKey(resolvedTarget?.id) || null;
          pinsTargetKind = pinsTargetModeForTarget(resolvedTarget);
          persistPinsSelectionState();
          return findChannelById(pinsTargetChannelId) || resolvedTarget?.channel || null;
        }

        function resetWebhookTestDraft() {
          webhookTestDraft = { content: '', attachments: [] };
        }

        function closeHub() {
          clearWorkspaceTimer();
          window.removeEventListener('keydown', onCommunityHubEscape);
          if (communityHubController?.overlay === (embedded ? mount : overlay)) {
            communityHubController = null;
          }
          if (embedded) {
            closeCommunityHubPage();
            return;
          }
          overlay.remove();
        }

        function markLoading(next) {
          loading = !!next;
          renderBody();
        }

        function channelLabelForHit(hit) {
          if (!hit) return 'channel';
          if (hit.channel_type === 'dm') return hit.channel_name || 'DM';
          if (hit.server_name) return `${hit.server_name} · #${hit.channel_name || 'channel'}`;
          return `#${hit.channel_name || 'channel'}`;
        }

        async function resolveSearchAuthorId() {
          const raw = String(searchDraft.authorQuery || '').trim();
          if (!raw) {
            searchDraft.authorId = null;
            return null;
          }
          if (/^(aspc|nubu)_/i.test(raw)) {
            searchDraft.authorId = idKey(raw);
            return searchDraft.authorId;
          }
          try {
            const user = await users.lookup(raw);
            const resolved = idKey(user?.id);
            searchDraft.authorId = resolved || null;
            if (!resolved) {
              toast('Could not resolve that author', 'error');
              return null;
            }
            return resolved;
          } catch (error) {
            searchDraft.authorId = null;
            toast(error?.message || 'Could not resolve that author', 'error');
            return null;
          }
        }

        function jumpToSearchHit(hit) {
          if (!hit?.message?.id) return;
          const openTarget = async () => {
            if (hit.channel_type === 'dm') {
              store.set({ sidebarMode: 'dms', activeServerId: null });
              renderIconSidebar();
              renderChanSidebar();
              renderMemberSidebar();
              await selectDm(hit.channel_id);
            } else {
              if (!idsEqual(store.state.activeServerId, hit.server_id) && hit.server_id) {
                await selectServer(hit.server_id);
              }
              await selectChannel(hit.channel_id);
            }
            window.setTimeout(() => {
              msgListEl?.jumpToMessage?.(hit.message.id);
            }, 100);
          };
          void openTarget().catch(() => { });
          closeHub();
        }

        async function loadSearch() {
          if (!communityToolsEnabled()) return;
          const authorId = await resolveSearchAuthorId();
          if (searchDraft.authorQuery && !authorId) {
            return;
          }
          const params = {
            q: searchDraft.q || '',
            limit: 30,
          };
          const scope = searchDraft.scope || 'channel';
          if (scope === 'channel' && activeChannel?.id) params.channel_id = activeChannel.id;
          else if (scope === 'server' && currentServerId) params.server_id = currentServerId;
          if (authorId) params.author_id = authorId;
          if (searchDraft.attachments) params.has_attachments = true;
          if (searchDraft.reactions) params.has_reactions = true;
          if (searchDraft.pinned) params.is_pinned = true;
          if (searchDraft.createdAfter) params.created_after = searchDraft.createdAfter;
          if (searchDraft.createdBefore) params.created_before = searchDraft.createdBefore;
          markLoading(true);
          try {
            const results = await messages.search(params);
            searchResults = Array.isArray(results) ? results : (results?.items || []);
            renderBody();
          } catch (error) {
            toast(error?.message || 'Search failed', 'error');
          } finally {
            markLoading(false);
          }
        }

        async function loadDiscover() {
          markLoading(true);
          try {
            const [usersResult, serversResult] = await Promise.all([
              users.directory({ recommended: directoryRecommendationsEnabled() }).catch(() => []),
              servers.directory({ recommended: directoryRecommendationsEnabled() }).catch(() => []),
            ]);
            discoverUsers = Array.isArray(usersResult) ? usersResult : (usersResult?.items || []);
            discoverServers = Array.isArray(serversResult) ? serversResult : (serversResult?.items || []);
            renderBody();
          } catch (error) {
            toast(error?.message || 'Failed to load community directory', 'error');
          } finally {
            markLoading(false);
          }
        }

        async function loadPins() {
          const pinsChannel = resolvePinnedTargetChannel();
          if (!pinsChannel?.id) {
            pinnedMessages = [];
            renderBody();
            return;
          }
          markLoading(true);
          try {
            const data = await messages.pins(pinsChannel.id);
            pinnedMessages = Array.isArray(data) ? data : (data?.items || []);
            renderBody();
          } catch (error) {
            toast(error?.message || 'Failed to load pinned messages', 'error');
          } finally {
            markLoading(false);
          }
        }

        async function loadBookmarks() {
          markLoading(true);
          try {
            const data = await messages.bookmarks();
            bookmarkEntries = Array.isArray(data) ? data : (data?.items || []);
            renderBody();
          } catch (error) {
            toast(error?.message || 'Failed to load bookmarks', 'error');
          } finally {
            markLoading(false);
          }
        }

        async function loadWorkspace() {
          await ensureWorkspaceTargetsLoaded();
          const workspaceChannel = resolveWorkspaceTargetChannel();
          if (!workspaceChannel?.id) {
            workspaceDoc = null;
            workspaceDraft = null;
            workspaceDirty = false;
            workspaceEditorElement = null;
            renderBody();
            return;
          }
          markLoading(true);
          try {
            const data = await community.workspace.get(workspaceChannel.id, workspaceVisibility);
            workspaceDoc = data || null;
            workspaceDraft = buildWorkspaceDraftFromSource(workspaceDoc, workspaceChannel);
            workspaceVisibility = String(workspaceDoc?.visibility || workspaceVisibility || 'public').toLowerCase() === 'private' ? 'private' : 'public';
            persistWorkspaceSelectionState();
            workspaceDirty = false;
            renderBody();
          } catch (error) {
            toast(error?.message || 'Failed to load workspace', 'error');
          } finally {
            markLoading(false);
          }
        }

        async function loadWebhooks() {
          if (!currentServerId || !canManageWebhooks(currentServerId)) {
            webhookEntries = [];
            renderBody();
            return;
          }
          markLoading(true);
          try {
            const data = await community.webhooks.list(currentServerId);
            webhookEntries = Array.isArray(data) ? data : (data?.items || []);
            renderBody();
          } catch (error) {
            toast(error?.message || 'Failed to load webhooks', 'error');
          } finally {
            markLoading(false);
          }
        }

        async function loadActivity() {
          if (!currentServerId) {
            activityEntries = [];
            renderBody();
            return;
          }
          markLoading(true);
          try {
            const data = await community.activity(currentServerId);
            activityEntries = Array.isArray(data) ? data : (data?.items || []);
            renderBody();
          } catch (error) {
            toast(error?.message || 'Failed to load activity', 'error');
          } finally {
            markLoading(false);
          }
        }

        function refreshCurrentTab() {
          if (!isCommunityHubMounted()) return;
          if (currentTab === 'discover') return loadDiscover();
          if (currentTab === 'search') return loadSearch();
          if (currentTab === 'pins') return loadPins();
          if (currentTab === 'bookmarks') return loadBookmarks();
          if (currentTab === 'workspace') return workspaceDirty ? null : loadWorkspace();
          if (currentTab === 'activity') return loadActivity();
        }

        function renderSearchTab() {
          content.innerHTML = '';
          const filters = el('div', { class: 'community-filter-row' },
            el('input', { class: 'community-search-input', type: 'text', placeholder: 'Search messages, authors, or attachments...', value: searchDraft.q || '' }),
            el('input', { class: 'community-search-input', type: 'text', placeholder: 'Author username or #1234', value: searchDraft.authorQuery || '' }),
            el('select', { class: 'community-search-scope' },
              el('option', { value: 'channel' }, activeChannel ? `This channel (${resolveChannelLabel(activeChannel.id)})` : 'This channel'),
              el('option', { value: 'server', disabled: !currentServerId }, currentServerId ? 'This server' : 'No server selected')
            ),
            el('label', { class: 'community-checkbox' }, el('input', { type: 'checkbox', class: 'community-search-attachments' }), el('span', {}, 'Attachments')),
            el('label', { class: 'community-checkbox' }, el('input', { type: 'checkbox', class: 'community-search-reactions' }), el('span', {}, 'Reactions')),
            el('label', { class: 'community-checkbox' }, el('input', { type: 'checkbox', class: 'community-search-pinned' }), el('span', {}, 'Pinned')),
            el('input', { class: 'community-search-input', type: 'date', title: 'Created after', value: searchDraft.createdAfter || '' }),
            el('input', { class: 'community-search-input', type: 'date', title: 'Created before', value: searchDraft.createdBefore || '' }),
            el('button', { class: 'btn-confirm', type: 'button', onClick: () => loadSearch() }, 'Search')
          );
          const qInput = filters.querySelector('.community-search-input');
          const authorInput = filters.querySelectorAll('.community-search-input')[1];
          const scopeSelect = filters.querySelector('.community-search-scope');
          const attachmentsInput = filters.querySelector('.community-search-attachments');
          const reactionsInput = filters.querySelector('.community-search-reactions');
          const pinnedInput = filters.querySelector('.community-search-pinned');
          const dateInputs = filters.querySelectorAll('input[type="date"]');
          const createdAfterInput = dateInputs[0];
          const createdBeforeInput = dateInputs[1];
          if (scopeSelect) scopeSelect.value = searchDraft.scope || 'channel';
          if (attachmentsInput) attachmentsInput.checked = !!searchDraft.attachments;
          if (reactionsInput) reactionsInput.checked = !!searchDraft.reactions;
          if (pinnedInput) pinnedInput.checked = !!searchDraft.pinned;
          qInput?.addEventListener('input', () => { searchDraft.q = qInput.value; });
          authorInput?.addEventListener('input', () => {
            searchDraft.authorQuery = authorInput.value;
            searchDraft.authorId = null;
          });
          scopeSelect?.addEventListener('change', () => { searchDraft.scope = scopeSelect.value; });
          attachmentsInput?.addEventListener('change', () => { searchDraft.attachments = attachmentsInput.checked; });
          reactionsInput?.addEventListener('change', () => { searchDraft.reactions = reactionsInput.checked; });
          pinnedInput?.addEventListener('change', () => { searchDraft.pinned = pinnedInput.checked; });
          createdAfterInput?.addEventListener('change', () => { searchDraft.createdAfter = createdAfterInput.value; });
          createdBeforeInput?.addEventListener('change', () => { searchDraft.createdBefore = createdBeforeInput.value; });
          const list = el('div', { class: 'community-results-list' });
          if (!searchResults.length) {
            list.appendChild(el('div', { class: 'community-empty' }, loading ? 'Searching...' : 'Search messages in the current channel or server.'));
          } else {
            for (const hit of searchResults) {
              const message = hit.message || {};
              const author = message.webhook_name
                ? { username: message.webhook_name, display_name: message.webhook_name, avatar: message.webhook_avatar }
                : (message.author || userCache.get(message.author_id) || { username: 'Unknown', id: message.author_id });
              const card = el('button', {
                class: 'community-result-card',
                type: 'button',
                onClick: () => jumpToSearchHit(hit),
              },
                el('div', { class: 'community-result-head' },
                  avatarEl(displayName(author), 'community-result-avatar', 34, author.avatar),
                  el('div', { class: 'community-result-meta' },
                    el('div', { class: 'community-result-title' }, displayName(author), message.is_pinned ? el('span', { class: 'mini-pill' }, 'Pinned') : null),
                    el('div', { class: 'community-result-subtitle' }, `${channelLabelForHit(hit)} • ${fmtTime(message.created_at)}`)
                  )
                ),
                el('div', { class: 'community-result-content' }, messagePreviewText(message, 240)),
                message.reply_to ? el('div', { class: 'community-result-reply' }, `In reply to ${messagePreviewText(message.reply_to, 88)}`) : null
              );
              list.appendChild(card);
            }
          }
          content.append(filters, list);
        }

        function renderDiscoverTab() {
          content.innerHTML = '';
          const intro = el('div', { class: 'community-empty' }, 'Browse public servers and discover people who opted in.');
          const userSearch = el('input', { class: 'community-search-input', type: 'text', placeholder: 'Search users...' });
          const serverSearch = el('input', { class: 'community-search-input', type: 'text', placeholder: 'Search servers...' });
          const userCards = discoverUsers.length ? discoverUsers : [];
          const serverCards = discoverServers.length ? discoverServers : [];
          const usersList = el('div', { class: 'community-results-list' });
          const serverList = el('div', { class: 'community-results-list' });

          const renderUsers = () => {
            const q = (userSearch.value || '').trim().toLowerCase();
            usersList.innerHTML = '';
            const filtered = userCards.filter((user) => {
              const label = `${displayName(user)} ${user.username}#${user.discriminator} ${user.bio || ''} ${user.recommendation_reason || ''}`.toLowerCase();
              return !q || label.includes(q);
            });
            if (!filtered.length) {
              usersList.appendChild(el('div', { class: 'community-empty' }, 'No users matched your search.'));
              return;
            }
            for (const user of filtered) {
              const label = displayName(user);
              const card = el('div', { class: 'community-card' },
                el('div', { class: 'community-result-head' },
                  avatarEl(label, 'community-result-avatar', 34, user.avatar),
                  el('div', { class: 'community-result-meta' },
                    el('div', { class: 'community-result-title' }, label, user.recommendation_reason ? el('span', { class: 'suggestion-pill', title: user.recommendation_reason }, 'Suggested') : el('span', { class: 'mini-pill' }, user.directory_opt_in ? 'Public' : 'Private')),
                    el('div', { class: 'community-result-subtitle' }, user.recommendation_reason ? `${user.username}#${user.discriminator} • ${user.recommendation_reason}` : `${user.username}#${user.discriminator}`)
                  )
                ),
                user.bio ? el('div', { class: 'community-result-content' }, user.bio) : null,
                el('div', { class: 'community-card-actions' },
                  el('button', {
                    class: 'btn-soft',
                    type: 'button',
                    onClick: async () => {
                      try {
                        const dm = await dms.create(user.id);
                        if (!dm.participants?.length) {
                          dm.participants = [store.state.user, user].filter(Boolean);
                        }
                        upsertDmInState(dm);
                        renderIconSidebar();
                        renderChanSidebar();
                        await selectDm(dm.id);
                        closeHub();
                      } catch (error) {
                        toast(error?.message || 'Could not open DM', 'error');
                      }
                    },
                  }, 'Open DM')
                )
              );
              usersList.appendChild(card);
            }
          };

          const renderServers = () => {
            const q = (serverSearch.value || '').trim().toLowerCase();
            serverList.innerHTML = '';
            const filtered = serverCards.filter((entry) => {
              const server = entry?.server || {};
              const label = `${server.name || ''} ${server.description || ''} ${entry.recommendation_reason || ''}`.toLowerCase();
              return !q || label.includes(q);
            });
            if (!filtered.length) {
              serverList.appendChild(el('div', { class: 'community-empty' }, 'No servers matched your search.'));
            } else {
              for (const entry of filtered) {
                const server = entry.server || {};
                serverList.appendChild(
                  el('div', { class: 'community-card' },
                    el('div', { class: 'community-result-head' },
                      avatarEl(server.name || 'Server', 'community-result-avatar', 34, server.icon),
                      el('div', { class: 'community-result-meta' },
                        el('div', { class: 'community-result-title' }, server.name || 'Server', entry.recommendation_reason ? el('span', { class: 'suggestion-pill', title: entry.recommendation_reason }, 'Suggested') : el('span', { class: 'mini-pill' }, `${entry.member_count || 0} Members`)),
                        el('div', { class: 'community-result-subtitle' }, entry.recommendation_reason ? `${server.description || 'No description yet.'} • ${entry.recommendation_reason}` : server.description || 'No description yet.')
                      )
                    ),
                    el('div', { class: 'community-card-actions' },
                      el('button', {
                        class: 'btn-soft',
                        type: 'button',
                        onClick: async () => {
                          try {
                            if (!entry.joined) {
                              await servers.join(server.id);
                              entry.joined = true;
                              const existing = store.state.servers || [];
                              if (!existing.some((srv) => idsEqual(srv.id, server.id))) {
                                store.set({ servers: [server, ...existing] });
                              }
                            }
                            await selectServer(server.id);
                            closeHub();
                          } catch (error) {
                            toast(error?.message || 'Could not join server', 'error');
                          }
                        },
                      }, entry.joined ? 'Open Server' : 'Join Server')
                    )
                  )
                );
              }
            }
          };

          const userSection = el('div', { class: 'community-card' },
            el('div', { class: 'community-workspace-label' }, 'People'),
            userSearch,
          );
          const serverSection = el('div', { class: 'community-card' },
            el('div', { class: 'community-workspace-label' }, 'Servers'),
            serverSearch,
          );
          userSearch.addEventListener('input', renderUsers);
          serverSearch.addEventListener('input', renderServers);
          userSection.append(usersList);
          serverSection.append(serverList);
          content.append(intro, userSection, serverSection);
          renderUsers();
          renderServers();
        }

        function renderPinnedTab() {
          content.innerHTML = '';
          const pinTargets = listPinsTargets();
          if (!pinTargets.length) {
            content.appendChild(el('div', { class: 'community-empty' }, 'No DMs or text channels are available for pins yet.'));
            return;
          }
          const pinnedChannel = resolvePinnedTargetChannel();
          if (!pinnedChannel?.id) {
            content.appendChild(el('div', { class: 'community-empty' }, 'Choose a DM or server channel to view pinned messages.'));
            return;
          }
          const workspaceTarget = pinTargets.find((item) => idsEqual(item.id, pinnedChannel.id)) || null;
          const dmTargets = listPinsDmTargets(pinTargets);
          const serverScopes = listPinsServerScopes(pinTargets);
          const selectedMode = String(store.state.communityHubPinsTargetKind || pinsTargetKind || pinsTargetModeForTarget(workspaceTarget)).toLowerCase() === 'dm' ? 'dm' : 'server';
          pinsTargetKind = selectedMode;
          const currentServerScope = selectedMode === 'server'
            ? serverScopes.find((scope) => scope.channels.some((channel) => idsEqual(channel.id, workspaceTarget?.id)))
            || serverScopes[0]
            || null
            : null;
          const modePicker = el('select', { class: 'community-select community-workspace-picker' },
            el('option', { value: 'dm' }, 'Direct Messages'),
            el('option', { value: 'server' }, 'Servers')
          );
          modePicker.value = selectedMode;
          const scopePicker = el('select', { class: 'community-select community-workspace-picker' },
            ...(selectedMode === 'dm'
              ? dmTargets.map((item) => el('option', { value: String(item.id) }, item.label))
              : serverScopes.map((scope) => el('option', { value: String(scope.serverId) }, scope.label)))
          );
          scopePicker.value = selectedMode === 'dm'
            ? String(workspaceTarget?.id || dmTargets[0]?.id || 0)
            : String(currentServerScope?.serverId || serverScopes[0]?.serverId || 0);
          const channelPicker = el('select', { class: 'community-select community-workspace-picker' });
          if (selectedMode === 'server') {
            const serverChannels = currentServerScope?.channels || [];
            for (const channel of serverChannels) {
              channelPicker.appendChild(el('option', { value: String(channel.id) }, channel.label));
            }
          }
          channelPicker.value = selectedMode === 'server'
            ? String(workspaceTarget?.id || currentServerScope?.channels?.[0]?.id || pinnedChannel.id)
            : String(pinnedChannel.id);
          const list = el('div', { class: 'community-results-list' });
          if (!pinnedMessages.length) {
            list.appendChild(el('div', { class: 'community-empty' }, loading ? 'Loading pins...' : 'No pinned messages yet.'));
          } else {
            for (const msg of pinnedMessages) {
              const author = msg.webhook_name
                ? { username: msg.webhook_name, display_name: msg.webhook_name, avatar: msg.webhook_avatar }
                : (msg.author || userCache.get(msg.author_id) || { username: 'Unknown', id: msg.author_id });
              const canUnpin = idsEqual(msg.author_id, store.state.user?.id) || (pinnedChannel.server_id ? canModerateServer(pinnedChannel.server_id) : false);
              list.appendChild(
                el('div', { class: 'community-card' },
                  el('div', { class: 'community-result-head' },
                    avatarEl(displayName(author), 'community-result-avatar', 34, author.avatar),
                    el('div', { class: 'community-result-meta' },
                      el('div', { class: 'community-result-title' }, displayName(author), el('span', { class: 'mini-pill' }, 'Pinned')),
                      el('div', { class: 'community-result-subtitle' }, fmtTime(msg.created_at))
                    )
                  ),
                  el('div', { class: 'community-result-content' }, messagePreviewText(msg, 240)),
                  el('div', { class: 'community-card-actions' },
                    el('button', {
                      class: 'btn-soft', type: 'button', onClick: () => {
                        jumpToSearchHit({
                          ...msg,
                          channel_id: pinnedChannel.id,
                          server_id: pinnedChannel.server_id,
                          channel_type: pinnedChannel.type,
                          channel_name: pinnedChannel.name,
                          server_name: null,
                          message: msg,
                        });
                      }
                    }, 'Open'),
                    canUnpin ? el('button', {
                      class: 'btn-soft btn-danger-ghost', type: 'button', onClick: async () => {
                        try {
                          await messages.unpin(msg.id);
                          await loadPins();
                        } catch (error) {
                          toast(error?.message || 'Could not unpin message', 'error');
                        }
                      }
                    }, 'Unpin') : null
                  )
                )
              );
            }
          }
          modePicker.addEventListener('change', async () => {
            const nextMode = modePicker.value === 'dm' ? 'dm' : 'server';
            if (nextMode === selectedMode) return;
            const nextTarget = nextMode === 'dm'
              ? (dmTargets.find((item) => idsEqual(item.id, pinsTargetChannelId)) || dmTargets[0] || null)
              : ((serverScopes.find((scope) => idsEqual(scope.serverId, currentServerScope?.serverId)) || serverScopes[0] || null)?.channels?.[0] || null);
            if (!nextTarget?.id) {
              modePicker.value = selectedMode;
              toast(nextMode === 'dm' ? 'No direct messages are available for pins yet.' : 'No server channels are available for pins yet.', 'error');
              return;
            }
            pinsTargetKind = nextMode;
            pinsTargetChannelId = idKey(nextTarget.id) || null;
            persistPinsSelectionState();
            pinnedMessages = [];
            renderBody();
            await loadPins();
          });
          scopePicker.addEventListener('change', async () => {
            if (selectedMode === 'dm') {
              const nextDmId = idKey(scopePicker.value);
              if (!nextDmId || idsEqual(nextDmId, pinnedChannel.id)) return;
              pinsTargetKind = 'dm';
              pinsTargetChannelId = nextDmId;
            } else {
              const nextServerId = idKey(scopePicker.value);
              const nextScope = serverScopes.find((scope) => idsEqual(scope.serverId, nextServerId)) || currentServerScope || null;
              const nextTarget = nextScope?.channels?.[0] || null;
              if (!nextTarget?.id || idsEqual(nextTarget.id, pinnedChannel.id)) return;
              pinsTargetKind = 'server';
              pinsTargetChannelId = idKey(nextTarget.id) || null;
            }
            persistPinsSelectionState();
            pinnedMessages = [];
            renderBody();
            await loadPins();
          });
          channelPicker.addEventListener('change', async () => {
            if (selectedMode !== 'server') return;
            const nextChannelId = idKey(channelPicker.value);
            if (!nextChannelId || idsEqual(nextChannelId, pinnedChannel.id)) return;
            pinsTargetKind = 'server';
            pinsTargetChannelId = nextChannelId;
            persistPinsSelectionState();
            pinnedMessages = [];
            renderBody();
            await loadPins();
          });
          content.append(
            el('div', { class: 'community-workspace-toolbar' },
              el('div', { class: 'community-workspace-context' },
                el('div', { class: 'community-workspace-label' }, 'Pins Scope'),
                modePicker,
                el('div', { class: 'community-workspace-context-note' }, 'Choose whether you want to browse direct messages or servers for pinned messages.')
              ),
              el('div', { class: 'community-workspace-context' },
                el('div', { class: 'community-workspace-label' }, selectedMode === 'dm' ? 'Direct Message' : 'Server'),
                scopePicker,
                el('div', { class: 'community-workspace-context-note' }, selectedMode === 'dm'
                  ? 'Pick the direct message thread whose pins you want to inspect.'
                  : 'Pick the server whose channel pins you want to inspect.')
              ),
              ...(selectedMode === 'server' ? [
                el('div', { class: 'community-workspace-context' },
                  el('div', { class: 'community-workspace-label' }, 'Channel'),
                  channelPicker,
                  el('div', { class: 'community-workspace-context-note' }, 'Choose the exact channel inside the selected server.')
                ),
              ] : []),
            ),
            list
          );
        }

        function renderBookmarksTab() {
          content.innerHTML = '';
          const list = el('div', { class: 'community-results-list' });
          if (!bookmarkEntries.length) {
            list.appendChild(el('div', { class: 'community-empty' }, loading ? 'Loading bookmarks...' : 'No saved messages yet.'));
          } else {
            for (const item of bookmarkEntries) {
              const msg = item.message || {};
              const channel = findChannelById(msg.channel_id) || {};
              const author = msg.webhook_name
                ? { username: msg.webhook_name, display_name: msg.webhook_name, avatar: msg.webhook_avatar }
                : (msg.author || userCache.get(msg.author_id) || { username: 'Unknown', id: msg.author_id });
              list.appendChild(
                el('div', { class: 'community-card' },
                  el('div', { class: 'community-result-head' },
                    avatarEl(displayName(author), 'community-result-avatar', 34, author.avatar),
                    el('div', { class: 'community-result-meta' },
                      el('div', { class: 'community-result-title' }, displayName(author)),
                      el('div', { class: 'community-result-subtitle' }, `${resolveChannelLabel(msg.channel_id)} • Saved ${fmtTime(item.saved_at)}`)
                    )
                  ),
                  el('div', { class: 'community-result-content' }, messagePreviewText(msg, 240)),
                  el('div', { class: 'community-card-actions' },
                    el('button', {
                      class: 'btn-soft', type: 'button', onClick: async () => {
                        if (channel?.id) {
                          if (!idsEqual(store.state.activeServerId, channel.server_id) && channel.server_id) {
                            await selectServer(channel.server_id);
                          }
                          if (String(channel.type || '').toLowerCase() === 'dm') {
                            await selectDm(msg.channel_id);
                          } else if (!idsEqual(store.state.activeChannelId, msg.channel_id)) {
                            await selectChannel(msg.channel_id);
                          }
                          window.setTimeout(() => msgListEl?.jumpToMessage?.(msg.id), 100);
                        }
                        closeHub();
                      }
                    }, 'Open'),
                    el('button', {
                      class: 'btn-soft btn-danger-ghost', type: 'button', onClick: async () => {
                        try {
                          await messages.unbookmark(msg.id);
                          await loadBookmarks();
                        } catch (error) {
                          toast(error?.message || 'Could not remove bookmark', 'error');
                        }
                      }
                    }, 'Remove')
                  )
                )
              );
            }
          }
          content.append(list);
        }

        function renderWorkspaceTab() {
          content.innerHTML = '';
          const workspaceTargets = listWorkspaceTargets();
          if (!workspaceTargets.length) {
            content.appendChild(el('div', { class: 'community-empty' }, 'No DMs or channels are available for workspaces yet.'));
            return;
          }
          const workspaceChannel = resolveWorkspaceTargetChannel();
          if (!workspaceChannel?.id) {
            content.appendChild(el('div', { class: 'community-empty' }, 'Select a channel to open its workspace.'));
            return;
          }
          const workspaceTarget = workspaceTargets.find((item) => idsEqual(item.id, workspaceChannel.id)) || null;
          const dmTargets = listWorkspaceDmTargets(workspaceTargets);
          const serverScopes = listWorkspaceServerScopes(workspaceTargets);
          const workspaceTargetMode = String(store.state.communityHubWorkspaceTargetKind || workspaceTargetKind || workspaceTargetModeForTarget(workspaceTarget)).toLowerCase() === 'dm' ? 'dm' : 'server';
          workspaceTargetKind = workspaceTargetMode;
          const currentServerScope = workspaceTargetMode === 'server'
            ? serverScopes.find((scope) => scope.channels.some((channel) => idsEqual(channel.id, workspaceTarget?.id)))
            || serverScopes[0]
            || null
            : null;
          const draft = workspaceDraft || buildWorkspaceDraftFromSource(workspaceDoc, workspaceChannel);
          const formTitle = el('input', { class: 'community-input', type: 'text', value: draft.title || `${resolveChannelLabel(workspaceChannel.id)} Workspace`, maxlength: '120' });
          const formMode = el('select', { class: 'community-select', style: 'display:none;' },
            el('option', { value: 'writing' }, 'Writing'),
            el('option', { value: 'code' }, 'Code')
          );
          formMode.value = draft.mode || 'writing';
          const formLanguage = el('select', { class: 'community-select' },
            ...WORKSPACE_LANGUAGE_OPTIONS.map(([value, label]) => el('option', { value }, label))
          );
          formLanguage.value = normalizeWorkspaceLanguage(draft.language);
          const editor = el('textarea', {
            class: `community-workspace-editor${formMode.value === 'code' ? ' code' : ''}`,
            wrap: 'off',
            spellcheck: 'false',
            autocapitalize: 'off',
            autocomplete: 'off',
            autocorrect: 'off',
          });
          editor.value = draft.content || '';
          workspaceEditorElement = editor;
          const editorMirror = el('pre', { class: 'community-workspace-code-mirror', 'aria-hidden': 'true' });
          const editorShell = el('div', { class: `community-workspace-editor-shell${formMode.value === 'code' ? ' code' : ''}` }, editorMirror, editor);
          const saveBtn = el('button', { class: 'btn-confirm', type: 'button' }, 'Save');
          const revisions = el('div', { class: 'community-revisions' });
          const preview = el('pre', { class: 'community-workspace-preview' });
          const modeWritingBtn = el('button', { class: `community-workspace-mode-btn${formMode.value === 'writing' ? ' active' : ''}`, type: 'button' }, 'Writing');
          const modeCodeBtn = el('button', { class: `community-workspace-mode-btn${formMode.value === 'code' ? ' active' : ''}`, type: 'button' }, 'Code');
          const modeHint = el('div', { class: 'community-result-subtitle' });
          const targetModePicker = el('select', { class: 'community-select community-workspace-picker' },
            el('option', { value: 'dm' }, 'Direct Messages'),
            el('option', { value: 'server' }, 'Servers')
          );
          targetModePicker.value = workspaceTargetMode;
          const spacePicker = el('select', { class: 'community-select community-workspace-picker' },
            ...(workspaceTargetMode === 'dm'
              ? dmTargets.map((item) => el('option', { value: String(item.id) }, item.label))
              : serverScopes.map((scope) => el('option', { value: String(scope.serverId) }, scope.label)))
          );
          spacePicker.value = workspaceTargetMode === 'dm'
            ? String(workspaceTarget?.id || dmTargets[0]?.id || 0)
            : String(currentServerScope?.serverId || serverScopes[0]?.serverId || 0);
          const channelPicker = el('select', { class: 'community-select community-workspace-picker' },
            ...(workspaceTargetMode === 'server'
              ? (currentServerScope?.channels || []).map((item) => el('option', { value: String(item.id) }, item.label))
              : [])
          );
          channelPicker.value = workspaceTargetMode === 'server'
            ? String(workspaceTarget?.id || currentServerScope?.channels?.[0]?.id || workspaceChannel.id)
            : String(workspaceChannel.id);
          const visibilityPicker = el('select', { class: 'community-select community-workspace-picker' },
            el('option', { value: 'public' }, 'Public Workspace'),
            el('option', { value: 'private' }, 'Private Workspace')
          );
          visibilityPicker.value = workspaceVisibility;
          const languageMeta = el('div', { class: 'community-workspace-meta' },
            el('div', { class: 'community-workspace-label' }, 'Language'),
            formLanguage
          );
          const previewCard = el('div', { class: 'community-workspace-pane' },
            el('div', { class: 'community-workspace-section-title' }, 'Syntax Preview'),
            preview,
          );

          const snapshotDraft = () => ({
            title: formTitle.value,
            mode: formMode.value,
            language: formLanguage.value,
            content: editor.value,
          });

          const renderRevisionRows = () => {
            revisions.innerHTML = '';
            const revisionRows = (workspaceDoc?.revisions || []).slice(0, 10).map((revision) =>
              el('div', { class: 'community-revision-row' },
                el('div', { class: 'community-revision-title' }, fmtTime(revision.created_at)),
                el('div', { class: 'community-revision-meta' }, revision.editor_user_id ? `Edited by #${revision.editor_user_id}` : 'System'),
                el('div', { class: 'community-revision-snippet' }, messagePreviewText({ content: revision.content }, 120))
              )
            );
            if (!revisionRows.length) {
              revisions.appendChild(el('div', { class: 'community-empty' }, 'No revisions yet.'));
            } else {
              revisionRows.forEach((row) => revisions.appendChild(row));
            }
          };

          const updateModeUI = () => {
            modeWritingBtn.classList.toggle('active', formMode.value === 'writing');
            modeCodeBtn.classList.toggle('active', formMode.value === 'code');
            editor.classList.toggle('code', formMode.value === 'code');
            editorShell.classList.toggle('code', formMode.value === 'code');
            editorMirror.hidden = formMode.value !== 'code';
            languageMeta.hidden = formMode.value !== 'code';
            previewCard.hidden = formMode.value !== 'code';
            modeHint.textContent = formMode.value === 'code'
              ? 'Code mode supports language-aware previewing and real Tab indentation in the editor.'
              : 'Writing mode is tuned for collaborative prose, notes, and documentation.';
            setWorkspacePreview(preview, editor.value, formLanguage.value);
            setWorkspaceEditorMirror(editorMirror, editor.value, formLanguage.value);
            syncWorkspaceEditorMirror(editor, editorMirror);
          };

          const currentSelectionTargets = () => {
            if (workspaceTargetMode === 'dm') {
              return dmTargets;
            }
            return currentServerScope?.channels || [];
          };

          const saveWorkspace = async (recordActivity = false) => {
            clearWorkspaceTimer();
            try {
              workspaceRefreshSuppressedUntil = Date.now() + 1500;
              const updated = await community.workspace.update(workspaceChannel.id, {
                title: formTitle.value.trim() || `${resolveChannelLabel(workspaceChannel.id)} Workspace`,
                mode: formMode.value,
                language: formLanguage.value,
                content: editor.value,
                visibility: workspaceVisibility,
                log_activity: !!recordActivity,
              });
              workspaceDoc = updated || workspaceDoc;
              workspaceDraft = buildWorkspaceDraftFromSource(workspaceDoc || snapshotDraft(), workspaceChannel);
              workspaceVisibility = String(updated?.visibility || workspaceVisibility || 'public').toLowerCase() === 'private' ? 'private' : 'public';
              persistWorkspaceSelectionState();
              workspaceDirty = false;
              renderRevisionRows();
              setWorkspacePreview(preview, editor.value, formLanguage.value);
            } catch (error) {
              toast(error?.message || 'Could not save workspace', 'error');
            }
          };

          const scheduleSave = () => {
            clearWorkspaceTimer();
            workspaceTimer = setTimeout(() => { void saveWorkspace(); }, 600);
          };

          modeWritingBtn.addEventListener('click', () => {
            if (formMode.value === 'writing') return;
            formMode.value = 'writing';
            updateWorkspaceDraftState(snapshotDraft());
            updateModeUI();
            scheduleSave();
          });
          modeCodeBtn.addEventListener('click', () => {
            if (formMode.value === 'code') return;
            formMode.value = 'code';
            updateWorkspaceDraftState(snapshotDraft());
            updateModeUI();
            scheduleSave();
          });

          targetModePicker.addEventListener('change', async () => {
            const nextMode = targetModePicker.value === 'dm' ? 'dm' : 'server';
            if (nextMode === workspaceTargetMode && idsEqual(workspaceTarget?.id, workspaceChannel.id)) return;
            const nextTarget = nextMode === 'dm'
              ? (dmTargets.find((item) => idsEqual(item.id, workspaceTargetChannelId)) || dmTargets[0] || null)
              : ((serverScopes.find((scope) => idsEqual(scope.serverId, currentServerScope?.serverId)) || serverScopes[0] || null)?.channels?.[0] || null);
            if (!nextTarget?.id) {
              targetModePicker.value = workspaceTargetMode;
              toast(nextMode === 'dm' ? 'No direct messages are available for workspaces yet.' : 'No server channels are available for workspaces yet.', 'error');
              return;
            }
            if (workspaceDirty) {
              await saveWorkspace();
            }
            workspaceTargetKind = nextMode;
            workspaceTargetChannelId = idKey(nextTarget.id) || null;
            persistWorkspaceSelectionState();
            workspaceDoc = null;
            workspaceDraft = null;
            workspaceDirty = false;
            renderBody();
            await loadWorkspace();
          });

          formTitle.addEventListener('input', () => {
            updateWorkspaceDraftState(snapshotDraft());
            scheduleSave();
          });
          formMode.addEventListener('change', () => {
            updateModeUI();
            updateWorkspaceDraftState(snapshotDraft());
            scheduleSave();
          });
          formLanguage.addEventListener('change', () => {
            setWorkspacePreview(preview, editor.value, formLanguage.value);
            setWorkspaceEditorMirror(editorMirror, editor.value, formLanguage.value);
            updateWorkspaceDraftState(snapshotDraft());
            scheduleSave();
          });
          const syncWorkspaceTargetSelection = async () => {
            if (workspaceTargetMode === 'dm') {
              const nextDmId = idKey(spacePicker.value);
              if (!nextDmId || idsEqual(nextDmId, workspaceChannel.id)) return;
              if (workspaceDirty) {
                await saveWorkspace();
              }
              workspaceTargetKind = 'dm';
              workspaceTargetChannelId = nextDmId;
            } else {
              const nextServerId = idKey(spacePicker.value);
              const nextChannelId = idKey(channelPicker.value);
              const nextScope = serverScopes.find((scope) => idsEqual(scope.serverId, nextServerId)) || currentServerScope || null;
              const nextTarget = nextScope?.channels?.find((item) => idsEqual(item.id, nextChannelId))
                || nextScope?.channels?.[0]
                || null;
              if (!nextTarget?.id || idsEqual(nextTarget.id, workspaceChannel.id)) return;
              if (workspaceDirty) {
                await saveWorkspace();
              }
              workspaceTargetKind = 'server';
              workspaceTargetChannelId = idKey(nextTarget.id) || null;
            }
            persistWorkspaceSelectionState();
            workspaceDoc = null;
            workspaceDraft = null;
            workspaceDirty = false;
            renderBody();
            await loadWorkspace();
          };
          editor.addEventListener('keydown', (event) => {
            if (formMode.value === 'code' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
              event.preventDefault();
              editor.select();
              syncWorkspaceEditorMirror(editor, editorMirror);
              return;
            }
            if (formMode.value === 'code' && event.key === 'Backspace' && joinWorkspaceLineBackward(editor)) {
              event.preventDefault();
              editor.dispatchEvent(new Event('input', { bubbles: true }));
              return;
            }
            if (formMode.value !== 'code' || event.key !== 'Tab') return;
            event.preventDefault();
            if (event.shiftKey) outdentWorkspaceSelection(editor);
            else indentWorkspaceSelection(editor);
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          });
          editor.addEventListener('click', () => {
            syncWorkspaceEditorMirror(editor, editorMirror);
          });
          editor.addEventListener('select', () => {
            syncWorkspaceEditorMirror(editor, editorMirror);
            setWorkspaceEditorMirror(editorMirror, editor.value, formLanguage.value);
          });
          editor.addEventListener('scroll', () => {
            syncWorkspaceEditorMirror(editor, editorMirror);
          });
          editor.addEventListener('input', () => {
            setWorkspacePreview(preview, editor.value, formLanguage.value);
            setWorkspaceEditorMirror(editorMirror, editor.value, formLanguage.value);
            syncWorkspaceEditorMirror(editor, editorMirror);
            updateWorkspaceDraftState(snapshotDraft());
            scheduleSave();
          });
          spacePicker.addEventListener('change', () => { void syncWorkspaceTargetSelection(); });
          channelPicker.addEventListener('change', () => { void syncWorkspaceTargetSelection(); });
          visibilityPicker.addEventListener('change', async () => {
            const nextVisibility = visibilityPicker.value === 'private' ? 'private' : 'public';
            if (nextVisibility === workspaceVisibility) return;
            if (workspaceDirty) {
              await saveWorkspace();
            }
            workspaceVisibility = nextVisibility;
            persistWorkspaceSelectionState();
            workspaceDoc = null;
            workspaceDraft = null;
            workspaceDirty = false;
            renderBody();
            await loadWorkspace();
          });
          saveBtn.addEventListener('click', () => { void saveWorkspace(true); });
          renderRevisionRows();
          updateModeUI();

          const editorPane = el('div', { class: 'community-workspace-pane' },
            el('div', { class: 'community-workspace-head' },
              el('div', { class: 'community-workspace-meta' },
                el('div', { class: 'community-workspace-label' }, 'Title'),
                formTitle
              ),
              el('div', { class: 'community-workspace-meta' },
                el('div', { class: 'community-workspace-label' }, 'Mode'),
                formMode,
                el('div', { class: 'community-workspace-modebar' }, modeWritingBtn, modeCodeBtn)
              ),
              languageMeta,
            ),
            modeHint,
            editorShell,
            el('div', { class: 'community-workspace-actions' }, saveBtn),
          );
          const sidePane = el('div', { class: 'community-workspace-side' },
            previewCard,
            el('div', { class: 'community-workspace-section-title' }, 'Revision History'),
            revisions,
          );

          const workspaceTargetNote = workspaceTargetMode === 'dm'
            ? 'Choose a direct message, then edit that conversation workspace.'
            : 'Choose a server first, then pick the exact channel workspace inside it.';
          const workspaceTargetLabel = workspaceTargetMode === 'dm' ? 'Direct Message' : 'Server';
          const workspaceChannelLabel = workspaceTargetMode === 'dm' ? 'Channel / DM' : 'Channel';
          const channelContext = workspaceTargetMode === 'server'
            ? el('div', { class: 'community-workspace-context' },
              el('div', { class: 'community-workspace-label' }, workspaceChannelLabel),
              channelPicker,
              el('div', { class: 'community-workspace-context-note' }, 'Choose the exact channel workspace inside the selected server.')
            )
            : null;

          content.append(
            el('div', { class: 'community-workspace-toolbar' },
              el('div', { class: 'community-workspace-context' },
                el('div', { class: 'community-workspace-label' }, 'Workspace Type'),
                targetModePicker,
                el('div', { class: 'community-workspace-context-note' }, 'Switch between direct messages and servers to choose the workspace source.')
              ),
              el('div', { class: 'community-workspace-context' },
                el('div', { class: 'community-workspace-label' }, workspaceTargetLabel),
                spacePicker,
                el('div', { class: 'community-workspace-context-note' }, workspaceTargetNote)
              ),
              ...(channelContext ? [channelContext] : []),
              el('div', { class: 'community-workspace-context' },
                el('div', { class: 'community-workspace-label' }, 'Visibility'),
                visibilityPicker,
                el('div', { class: 'community-workspace-context-note' }, workspaceVisibility === 'private'
                  ? 'Private workspaces stay visible only to you and do not broadcast live updates.'
                  : `Public workspaces are shared in ${workspaceTarget?.kind === 'dm' ? 'this DM' : (workspaceTarget?.group || 'this space')} and keep revision history for everyone.`)
              )
            ),
            el('div', { class: 'community-workspace-grid' }, editorPane, sidePane),
          );
        }

        function renderWebhookTab() {
          content.innerHTML = '';
          if (!currentServerId) {
            content.appendChild(el('div', { class: 'community-empty' }, 'Select a server to manage webhooks.'));
            return;
          }
          if (!canManageWebhooks(currentServerId)) {
            content.appendChild(el('div', { class: 'community-empty' }, 'You need owner or admin permissions to manage webhooks.'));
            return;
          }
          const textChannels = (store.state.channels?.[currentServerId] || []).filter((channel) => String(channel.type || '').toLowerCase() === 'text');
          const webhookTestFileInput = el('input', { type: 'file', multiple: 'multiple' });
          webhookTestFileInput.style.display = 'none';
          const webhookTestContent = el('textarea', {
            class: 'community-workspace-editor',
            placeholder: 'Write a test webhook message...',
            maxlength: '4000',
          });
          webhookTestContent.value = webhookTestDraft.content || '';
          const webhookTestAttachments = el('div', { class: 'composer-attachments' });
          const webhookTestStatus = el('div', { class: 'community-result-subtitle' }, 'Ready to test this webhook.');
          const webhookTestUploadBtn = el('button', { class: 'btn-soft', type: 'button' }, 'Upload Attachment');
          const webhookTestSendBtn = el('button', { class: 'btn-confirm', type: 'button' }, 'Send Test Message');
          const renderWebhookTestAttachments = () => {
            webhookTestAttachments.innerHTML = '';
            const items = Array.isArray(webhookTestDraft.attachments) ? webhookTestDraft.attachments : [];
            if (!items.length) {
              webhookTestAttachments.hidden = true;
              return;
            }
            webhookTestAttachments.hidden = false;
            items.forEach((url, index) => {
              const attachment = toAttachmentObj(url);
              webhookTestAttachments.appendChild(
                el('button', {
                  class: 'composer-attachment-chip',
                  type: 'button',
                  title: 'Remove attachment',
                  onClick: () => {
                    webhookTestDraft.attachments = webhookTestDraft.attachments.filter((_, itemIndex) => itemIndex !== index);
                    renderWebhookTestAttachments();
                  },
                },
                  el('span', { class: 'composer-attachment-kind' }, isGifUrl(attachment?.url || url) ? 'GIF' : 'File'),
                  el('span', { class: 'composer-attachment-name' }, attachment?.filename || 'Attachment'),
                  heroIcon('xMark', { size: 12 })
                )
              );
            });
          };
          webhookTestUploadBtn.addEventListener('click', () => webhookTestFileInput.click());
          webhookTestFileInput.addEventListener('change', async () => {
            const file = webhookTestFileInput.files?.[0];
            webhookTestFileInput.value = '';
            if (!file) return;
            try {
              const uploaded = await uploads.upload(file);
              const uploadedUrl = (uploaded?.url || uploaded?.file_url || '').trim();
              if (!uploadedUrl) throw new Error('Upload response missing URL');
              webhookTestDraft.attachments = [...(webhookTestDraft.attachments || []), uploadedUrl];
              renderWebhookTestAttachments();
              toast('Attachment uploaded', 'success');
            } catch (error) {
              toast(error?.message || 'Failed to upload attachment', 'error');
            }
          });
          webhookTestContent.addEventListener('input', () => {
            webhookTestDraft.content = webhookTestContent.value;
          });
          webhookTestSendBtn.addEventListener('click', async () => {
            if (!createSecret?.webhook?.id || !createSecret?.token) {
              toast('Create a webhook first so we have a token to test', 'error');
              return;
            }
            const content = webhookTestContent.value.trim();
            const attachments = Array.isArray(webhookTestDraft.attachments) ? webhookTestDraft.attachments : [];
            if (!content && !attachments.length) {
              toast('Enter a message or attach a file', 'error');
              return;
            }
            try {
              webhookTestStatus.textContent = 'Sending...';
              await community.webhooks.invoke(createSecret.webhook.id, createSecret.token, {
                content,
                attachments,
                username: createSecret.webhook?.name || formName.value.trim() || 'Webhook',
              });
              webhookTestDraft = { content: '', attachments: [] };
              webhookTestContent.value = '';
              renderWebhookTestAttachments();
              webhookTestStatus.textContent = 'Ready to test this webhook.';
              toast('Webhook test message sent', 'success');
              await loadWebhooks();
              renderWebhookTab();
            } catch (error) {
              webhookTestStatus.textContent = 'Webhook test failed.';
              toast(error?.message || 'Failed to send webhook test message', 'error');
            }
          });
          renderWebhookTestAttachments();
          const secretPanel = createSecret ? el('div', { class: 'community-secret-panel' },
            el('div', { class: 'community-secret-title' }, 'Webhook Created'),
            el('div', { class: 'community-secret-copy' }, 'Copy the token now. You will not be able to see it again.'),
            el('div', { class: 'community-secret-row' },
              el('input', { class: 'community-input', type: 'text', readonly: 'readonly', value: createSecret.token || '' }),
              el('button', {
                class: 'btn-soft', type: 'button', onClick: async () => {
                  await navigator.clipboard?.writeText(createSecret.token || '').catch(() => { });
                  toast('Token copied', 'success');
                }
              }, 'Copy Token')
            ),
            el('div', { class: 'community-secret-row' },
              el('input', { class: 'community-input', type: 'text', readonly: 'readonly', value: createSecret.webhook_url || '' }),
              el('button', {
                class: 'btn-soft', type: 'button', onClick: async () => {
                  await navigator.clipboard?.writeText(createSecret.webhook_url || '').catch(() => { });
                  toast('Webhook URL copied', 'success');
                }
              }, 'Copy URL')
            )
          ) : null;
          const testPanel = createSecret ? el('div', { class: 'community-card' },
            el('div', { class: 'community-secret-title' }, 'Test Message'),
            el('div', { class: 'community-secret-copy' }, 'Send a webhook test with uploaded attachments before sharing the URL.'),
            webhookTestStatus,
            webhookTestContent,
            webhookTestAttachments,
            el('div', { class: 'community-card-actions' }, webhookTestUploadBtn, webhookTestSendBtn),
            webhookTestFileInput,
          ) : null;

          const formName = el('input', { class: 'community-input', type: 'text', placeholder: 'Webhook name' });
          const formDesc = el('input', { class: 'community-input', type: 'text', placeholder: 'Optional description' });
          const channelSelect = el('select', { class: 'community-select' }, ...textChannels.map((channel) => el('option', { value: String(channel.id) }, `#${channel.name || 'channel'}`)));
          const createBtn = el('button', { class: 'btn-confirm', type: 'button' }, 'Create Webhook');
          createBtn.disabled = !textChannels.length;
          createBtn.addEventListener('click', async () => {
            const name = formName.value.trim();
            const channelId = idKey(channelSelect.value);
            if (!name || !channelId) {
              toast('Choose a name and target channel', 'error');
              return;
            }
            try {
              const created = await community.webhooks.create(currentServerId, {
                name,
                description: formDesc.value.trim() || null,
                channel_id: channelId,
              });
              createSecret = created;
              resetWebhookTestDraft();
              formName.value = '';
              formDesc.value = '';
              await loadWebhooks();
              renderWebhookTab();
            } catch (error) {
              toast(error?.message || 'Failed to create webhook', 'error');
            }
          });

          const cards = el('div', { class: 'community-results-list' });
          if (!webhookEntries.length) {
            cards.appendChild(el('div', { class: 'community-empty' }, loading ? 'Loading webhooks...' : 'No webhooks yet.'));
          } else {
            for (const webhook of webhookEntries) {
              const deliveries = deliveriesByWebhook.get(webhook.id) || [];
              const channel = findChannelById(webhook.channel_id);
              const deliveryRows = deliveries.length
                ? deliveries.map((delivery) =>
                  el('div', { class: 'community-delivery-row' },
                    el('div', { class: 'community-delivery-title' }, `${delivery.status} • ${delivery.attempts} attempt(s)`),
                    el('div', { class: 'community-delivery-meta' }, delivery.response_message || 'No response message'),
                    el('div', { class: 'community-delivery-time' }, fmtTime(delivery.created_at))
                  )
                )
                : [el('div', { class: 'community-empty' }, 'No delivery logs loaded.')];

              cards.appendChild(
                el('div', { class: 'community-card' },
                  el('div', { class: 'community-result-head' },
                    el('div', { class: 'community-result-meta' },
                      el('div', { class: 'community-result-title' }, webhook.name, webhook.active ? null : el('span', { class: 'mini-pill' }, 'Disabled')),
                      el('div', { class: 'community-result-subtitle' }, `${resolveChannelLabel(webhook.channel_id)} • ${webhook.description || 'No description'}`)
                    )
                  ),
                  el('div', { class: 'community-card-actions' },
                    webhook.webhook_url ? el('button', {
                      class: 'btn-soft', type: 'button', onClick: async () => {
                        await navigator.clipboard?.writeText(webhook.webhook_url || '').catch(() => { });
                        toast('Webhook URL copied', 'success');
                      }
                    }, 'Copy URL') : el('button', { class: 'btn-soft', type: 'button', disabled: true }, 'URL Hidden'),
                    el('button', {
                      class: 'btn-soft', type: 'button', onClick: async () => {
                        try {
                          const deliveries = await community.webhooks.deliveries(currentServerId, webhook.id);
                          const items = Array.isArray(deliveries) ? deliveries : (deliveries?.items || []);
                          deliveriesByWebhook.set(webhook.id, items);
                          renderWebhookTab();
                        } catch (error) {
                          toast(error?.message || 'Could not load deliveries', 'error');
                        }
                      }
                    }, 'View Deliveries'),
                    el('button', {
                      class: 'btn-soft btn-danger-ghost', type: 'button', onClick: async () => {
                        try {
                          await community.webhooks.delete(webhook.id);
                          await loadWebhooks();
                        } catch (error) {
                          toast(error?.message || 'Could not delete webhook', 'error');
                        }
                      }
                    }, 'Delete'),
                  ),
                  el('div', { class: 'community-delivery-list' }, ...deliveryRows)
                )
              );
            }
          }

          content.append(
            secretPanel,
            testPanel,
            el('div', { class: 'community-card' },
              el('div', { class: 'community-secret-title' }, 'Create Webhook'),
              el('div', { class: 'community-secret-copy' }, 'Webhooks can post into a designated text channel with a signed token.'),
              !textChannels.length ? el('div', { class: 'community-empty' }, 'This server has no text channels yet.') : null,
              el('div', { class: 'community-secret-row' }, formName),
              el('div', { class: 'community-secret-row' }, formDesc),
              el('div', { class: 'community-secret-row' }, channelSelect),
              el('div', { class: 'community-secret-row' }, createBtn),
            ),
            cards,
          );
        }

        function renderActivityTab() {
          content.innerHTML = '';
          const list = el('div', { class: 'community-results-list' });
          if (!activityEntries.length) {
            list.appendChild(el('div', { class: 'community-empty' }, loading ? 'Loading activity...' : 'No recent activity yet.'));
          } else {
            for (const entry of activityEntries) {
              list.appendChild(
                el('div', { class: 'community-card' },
                  el('div', { class: 'community-result-title' }, entry.action || 'activity'),
                  el('div', { class: 'community-result-subtitle' }, `${entry.target_type || 'item'}${entry.target_id ? ` #${entry.target_id}` : ''}`),
                  el('div', { class: 'community-result-content' }, formatActivityMetadata(entry.activity_metadata)),
                  el('div', { class: 'community-result-subtitle' }, fmtTime(entry.created_at))
                )
              );
            }
          }
          content.append(list);
        }

        function renderBody() {
          nav.querySelectorAll('.community-nav-btn').forEach((button) => {
            button.classList.toggle('active', button.dataset.tab === currentTab);
          });
          header.querySelector('.community-hub-subtitle').textContent = currentTab === 'search'
            ? 'Search, save, pin, and jump back to context.'
            : currentTab === 'discover'
              ? 'Browse people and servers from the community directory.'
              : currentTab === 'pins'
                ? (pinsTargetChannelId ? `Pinned messages for ${resolveChannelLabel(pinsTargetChannelId)}` : 'Browse pinned messages by DM or server channel.')
                : currentTab === 'bookmarks'
                  ? 'Your saved messages.'
                  : currentTab === 'workspace'
                    ? 'Live writing and coding workspace. Choose a DM or server channel and decide whether it is public or private.'
                    : 'Recent server activity and moderation history.';
          const workspaceStatusLabel = workspaceTargetChannelId
            ? `Workspace: ${resolveChannelLabel(workspaceTargetChannelId)} • ${workspaceVisibility === 'private' ? 'Private' : 'Public'}`
            : 'Pick a channel or DM to open its workspace';
          const pinsStatusLabel = pinsTargetChannelId
            ? `Pins: ${resolveChannelLabel(pinsTargetChannelId)}`
            : 'Pick a DM or server channel to view pins';
          const statusText = loading
            ? 'Loading...'
            : currentTab === 'workspace'
              ? workspaceStatusLabel
              : currentTab === 'pins'
                ? pinsStatusLabel
                : activeChannel?.id || store.state.activeChannelId
                  ? `Channel: ${resolveChannelLabel(activeChannel?.id || store.state.activeChannelId || 0)}`
                  : currentServerId
                    ? `Server: ${((store.state.servers || []).find((server) => idsEqual(server.id, currentServerId))?.name || 'Server')}`
                    : 'Browse the Wyvern community';
          setStatus(statusText);
          if (currentTab === 'search') renderSearchTab();
          else if (currentTab === 'discover') renderDiscoverTab();
          else if (currentTab === 'pins') renderPinnedTab();
          else if (currentTab === 'bookmarks') renderBookmarksTab();
          else if (currentTab === 'workspace') renderWorkspaceTab();
          else renderActivityTab();
        }

        for (const tab of tabs) {
          nav.appendChild(el('button', {
            class: `community-nav-btn${tab.id === currentTab ? ' active' : ''}`,
            type: 'button',
            'data-tab': tab.id,
            onClick: () => {
              if (embedded) {
                store.set({ communityHubTab: tab.id });
                renderChatMain();
                return;
              }
              currentTab = tab.id;
              renderBody();
              void refreshCurrentTab();
            },
          }, heroIcon(tab.icon, { size: 16 }), el('span', {}, tab.label)));
        }

        header.append(title, subtitle, status);
        panel.append(header, content, footer);
        shell.append(nav, panel);
        modal.appendChild(shell);
        if (embedded) {
          if (mount) {
            mount.innerHTML = '';
            mount.appendChild(modal);
          } else {
            chatMain.appendChild(modal);
          }
        } else {
          overlay.appendChild(modal);
          document.body.appendChild(overlay);
          overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeHub();
          });
        }
        window.addEventListener('keydown', onCommunityHubEscape);

        communityHubController = {
          overlay: embedded ? mount : overlay,
          refresh: refreshCurrentTab,
          close: closeHub,
          handleWorkspaceUpdate: (payload) => {
            if (!isCommunityHubMounted()) return;
            if (currentTab !== 'workspace') {
              void refreshCurrentTab();
              return;
            }
            const targetChannelId = idKey(resolveWorkspaceTargetChannel()?.id);
            const payloadChannelId = idKey(payload?.channel_id);
            const payloadVisibility = String(payload?.visibility || 'public').toLowerCase() === 'private' ? 'private' : 'public';
            if (!payloadChannelId || !idsEqual(targetChannelId, payloadChannelId) || payloadVisibility !== workspaceVisibility) {
              return;
            }
            const isEditing = workspaceDirty || (workspaceEditorElement && document.activeElement === workspaceEditorElement);
            const isLocalEcho = idsEqual(payload?.updated_by_user_id, store.state.user?.id)
              && Date.now() < workspaceRefreshSuppressedUntil;
            workspaceDoc = payload || workspaceDoc;
            if (isEditing || isLocalEcho) {
              return;
            }
            workspaceDraft = buildWorkspaceDraftFromSource(payload, resolveWorkspaceTargetChannel());
            renderBody();
          },
          handleActivityUpdate: (payload) => {
            if (!isCommunityHubMounted()) return;
            if (currentTab !== 'activity') {
              void refreshCurrentTab();
              return;
            }
            if (currentServerId && payload?.server_id && !idsEqual(payload.server_id, currentServerId)) {
              return;
            }
            activityEntries = [payload, ...activityEntries.filter((entry) => !idsEqual(entry?.id, payload?.id))].slice(0, 50);
            renderBody();
          },
          setTab: (nextTab) => {
            if (embedded) {
              store.set({ communityHubTab: nextTab });
              renderChatMain();
              return;
            }
            currentTab = nextTab;
            renderBody();
            void refreshCurrentTab();
          },
        };

        renderBody();
        void refreshCurrentTab();
      }

      async function openChannelFromNotification(channelId) {
        const target = idKey(channelId);
        if (!target) return;

        let dm = (store.state.dmList || []).find((item) => idsEqual(item?.id, target));
        if (!dm) {
          dm = await hydrateDmFromChannel(target);
        }
        if (dm) {
          store.set({ sidebarMode: 'dms', activeServerId: null });
          renderIconSidebar();
          renderChanSidebar();
          renderMemberSidebar();
          await selectDm(target);
          return;
        }

        let serverId = findServerIdForChannel(target);
        if (!serverId) {
          for (const srv of (store.state.servers || [])) {
            if (findServerIdForChannel(target)) {
              serverId = findServerIdForChannel(target);
              break;
            }
            if (store.state.channels?.[srv.id]) continue;
            try {
              const loaded = await channels.list(srv.id);
              store.set({ channels: { ...store.state.channels, [srv.id]: loaded || [] } });
              const discovered = findServerIdForChannel(target);
              if (discovered) {
                serverId = discovered;
                break;
              }
            } catch { }
          }
        }
        if (!serverId) return;
        if (!idsEqual(store.state.activeServerId, serverId)) {
          await selectServer(serverId);
        }
        await selectChannel(target);
      }

      async function notifyIncomingMessage(message) {
        if (!message?.channel_id) return;
        const currentUserId = store.state.user?.id;
        if (currentUserId && idsEqual(message.author_id, currentUserId)) return;

        let authorName = 'Someone';
        if (message.author?.id) {
          if (message.author.id) userCache.set(message.author.id, message.author);
          authorName = displayName(message.author);
        } else if (message.author_id) {
          const cached = userCache.get(message.author_id) || await getUserCached(message.author_id);
          if (cached?.id) userCache.set(cached.id, cached);
          authorName = displayName(cached || { username: 'Unknown' });
        }

        playSoundEffect('ping');

        const preview = messagePreviewText(message, 120);
        const channelLabel = resolveChannelLabel(message.channel_id);

        pushNotification({
          title: 'New Message',
          body: `${authorName}: ${preview}`,
          meta: channelLabel,
          duration: 15000,
          onClick: () => openChannelFromNotification(message.channel_id),
        });
      }

      function ensureVoiceParticipantsEntry(channelId, userIds) {
        const voiceMap = { ...(store.state.voiceParticipants || {}) };
        const normalizedChannelId = idKey(channelId);
        if (!normalizedChannelId) return;
        voiceMap[normalizedChannelId] = Array.from(new Set((userIds || []).map(idKey).filter(Boolean)));
        store.set({ voiceParticipants: voiceMap });
      }

      function removeVoiceParticipantsEntry(channelId) {
        const voiceMap = { ...(store.state.voiceParticipants || {}) };
        delete voiceMap[idKey(channelId)];
        store.set({ voiceParticipants: voiceMap });
      }

      function ensureRemoteAudioElement(userId) {
        if (voiceState.remoteAudioEls.has(userId)) return voiceState.remoteAudioEls.get(userId);
        const audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.style.display = 'none';
        audio.dataset.voiceRemoteUserId = String(userId);
        document.body.appendChild(audio);
        voiceState.remoteAudioEls.set(userId, audio);
        return audio;
      }

      function getVoicePeerMeta(userId) {
        if (!voiceState.peerMeta.has(userId)) {
          voiceState.peerMeta.set(userId, { pendingIce: [], retryTimer: null, retries: 0 });
        }
        return voiceState.peerMeta.get(userId);
      }

      function clearVoiceOfferRetry(userId) {
        const meta = voiceState.peerMeta.get(userId);
        if (!meta) return;
        if (meta.retryTimer) {
          clearTimeout(meta.retryTimer);
          meta.retryTimer = null;
        }
        meta.retries = 0;
      }

      async function flushPendingVoiceIce(userId, peer) {
        const meta = getVoicePeerMeta(userId);
        if (!meta.pendingIce.length) return;
        const queued = [...meta.pendingIce];
        meta.pendingIce = [];
        for (const candidate of queued) {
          try {
            await peer.addIceCandidate(candidate);
          } catch { }
        }
      }

      function startVoiceStatusPolling(channelId) {
        if (voiceState.statusPollTimer) {
          clearInterval(voiceState.statusPollTimer);
          voiceState.statusPollTimer = null;
        }
        voiceState.statusPollTimer = setInterval(() => {
          if (!voiceState.joinedChannelId || !idsEqual(voiceState.joinedChannelId, channelId)) return;
          requestVoiceStatus(channelId);
        }, 4000);
      }

      function stopVoiceStatusPolling() {
        if (!voiceState.statusPollTimer) return;
        clearInterval(voiceState.statusPollTimer);
        voiceState.statusPollTimer = null;
      }

      function destroyRemoteAudioElement(userId) {
        const audio = voiceState.remoteAudioEls.get(userId);
        if (!audio) return;
        removeVoiceMeter(userId);
        try {
          if (audio.srcObject && typeof audio.srcObject.getTracks === 'function') {
            for (const track of audio.srcObject.getTracks()) track.stop();
          }
        } catch { }
        audio.remove();
        voiceState.remoteAudioEls.delete(userId);
      }

      function closeVoicePeer(userId) {
        const peer = voiceState.peers.get(userId);
        if (!peer) return;
        clearVoiceOfferRetry(userId);
        try { peer.ontrack = null; } catch { }
        try { peer.onicecandidate = null; } catch { }
        try { peer.onconnectionstatechange = null; } catch { }
        try { peer.close(); } catch { }
        voiceState.peers.delete(userId);
        voiceState.peerMeta.delete(userId);
        destroyRemoteAudioElement(userId);
      }

      async function ensureLocalVoiceStream() {
        if (voiceState.localStream) return voiceState.localStream;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceState.localStream = stream;
        voiceState.muted = false;
        await attachVoiceMeter(store.state.user?.id, stream);
        return stream;
      }

      function sendCallSignal(targetUserId, channelId, signalType, signalPayload) {
        if (!socket || !store.state.wsConnected) return;
        socket.send({
          action: 'call.signal',
          channel_id: channelId,
          target_user_id: targetUserId,
          signal_type: signalType,
          payload: signalPayload,
        });
      }

      function createVoicePeerConnection(remoteUserId, channelId) {
        if (voiceState.peers.has(remoteUserId)) return voiceState.peers.get(remoteUserId);
        if (!voiceState.localStream) return null;

        const meta = getVoicePeerMeta(remoteUserId);
        const peer = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });
        voiceState.peers.set(remoteUserId, peer);

        for (const track of voiceState.localStream.getTracks()) {
          peer.addTrack(track, voiceState.localStream);
        }

        peer.onicecandidate = (event) => {
          if (!event.candidate) return;
          sendCallSignal(remoteUserId, channelId, 'ice', event.candidate);
        };

        peer.ontrack = (event) => {
          const stream = event.streams?.[0];
          if (!stream) return;
          const audio = ensureRemoteAudioElement(remoteUserId);
          audio.srcObject = stream;
          audio.play().catch(() => { });
          attachVoiceMeter(remoteUserId, stream).catch(() => { });
        };

        peer.onconnectionstatechange = () => {
          if (peer.connectionState === 'connected') {
            clearVoiceOfferRetry(remoteUserId);
          }
          if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
            closeVoicePeer(remoteUserId);
            renderChatMain();
          }
        };

        if (!Array.isArray(meta.pendingIce)) meta.pendingIce = [];

        return peer;
      }

      async function sendVoiceOffer(remoteUserId, channelId) {
        const peer = createVoicePeerConnection(remoteUserId, channelId);
        if (!peer) return;
        if (peer.signalingState !== 'stable') return;
        const meta = getVoicePeerMeta(remoteUserId);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendCallSignal(remoteUserId, channelId, 'offer', peer.localDescription);

        clearVoiceOfferRetry(remoteUserId);
        if (meta.retries >= 3) return;
        meta.retryTimer = setTimeout(() => {
          meta.retryTimer = null;
          if (!idsEqual(voiceState.joinedChannelId, channelId)) return;
          const currentPeer = voiceState.peers.get(remoteUserId);
          if (!currentPeer) return;
          if (['connected', 'completed'].includes(currentPeer.connectionState)) return;
          meta.retries += 1;
          sendVoiceOffer(remoteUserId, channelId).catch(() => { });
        }, 2500 + (meta.retries * 1200));
      }

      async function syncVoicePeers(channelId, userIds) {
        const normalizedChannelId = idKey(channelId);
        const normalizedUsers = Array.from(new Set((userIds || []).map(idKey).filter(Boolean)));
        if (!normalizedChannelId) return;
        ensureVoiceParticipantsEntry(normalizedChannelId, normalizedUsers);

        if (idsEqual(store.state.activeChannelId, normalizedChannelId)) {
          renderChatMain();
        }
        if (!idsEqual(voiceState.joinedChannelId, normalizedChannelId)) return;

        const myId = idKey(store.state.user?.id);
        const others = normalizedUsers.filter((id) => !idsEqual(id, myId));

        for (const peerUserId of Array.from(voiceState.peers.keys())) {
          if (!others.some((id) => idsEqual(id, peerUserId))) {
            closeVoicePeer(peerUserId);
          }
        }

        for (const remoteUserId of others) {
          const existingPeer = voiceState.peers.get(remoteUserId);
          if (existingPeer && ['failed', 'closed', 'disconnected'].includes(existingPeer.connectionState)) {
            closeVoicePeer(remoteUserId);
          }
          if (!voiceState.peers.has(remoteUserId)) {
            createVoicePeerConnection(remoteUserId, normalizedChannelId);
            if (myId && myId < remoteUserId) {
              try { await sendVoiceOffer(remoteUserId, normalizedChannelId); } catch { }
            }
          }
        }
      }

      async function handleIncomingCallSignal(data) {
        const channelId = idKey(data?.channel_id);
        const fromUserId = idKey(data?.from_user_id);
        const signalType = String(data?.signal_type || '').toLowerCase();
        if (!channelId || !fromUserId || !signalType) return;
        if (!idsEqual(voiceState.joinedChannelId, channelId)) return;

        try {
          await ensureLocalVoiceStream();
          const peer = createVoicePeerConnection(fromUserId, channelId);
          if (!peer) return;
          const meta = getVoicePeerMeta(fromUserId);

          if (signalType === 'offer') {
            await peer.setRemoteDescription(new RTCSessionDescription(data?.payload));
            await flushPendingVoiceIce(fromUserId, peer);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            sendCallSignal(fromUserId, channelId, 'answer', peer.localDescription);
          } else if (signalType === 'answer') {
            if (!data?.payload) return;
            await peer.setRemoteDescription(new RTCSessionDescription(data.payload));
            await flushPendingVoiceIce(fromUserId, peer);
          } else if (signalType === 'ice') {
            if (!data?.payload) return;
            const candidate = new RTCIceCandidate(data.payload);
            if (!peer.remoteDescription || !peer.remoteDescription.type) {
              meta.pendingIce.push(candidate);
            } else {
              await peer.addIceCandidate(candidate);
            }
          }
        } catch (err) {
          console.warn('Voice signaling failed', err);
        }
      }

      async function leaveVoiceChannel(sendSignal = true) {
        const channelId = idKey(voiceState.joinedChannelId);
        if (!channelId) return;
        stopVoiceStatusPolling();

        if (sendSignal && socket && store.state.wsConnected) {
          socket.send({ action: 'leave_voice', channel_id: channelId });
        }

        for (const peerUserId of Array.from(voiceState.peers.keys())) {
          closeVoicePeer(peerUserId);
        }
        voiceState.peers.clear();

        if (voiceState.localStream) {
          removeVoiceMeter(store.state.user?.id);
          for (const track of voiceState.localStream.getTracks()) {
            try { track.stop(); } catch { }
          }
          voiceState.localStream = null;
        }

        voiceState.joinedChannelId = null;
        voiceState.muted = false;
        voiceState.speakingUsers.clear();
        stopVoiceMeterPolling();
        for (const userId of Array.from(voiceState.speakingMeters.keys())) {
          removeVoiceMeter(userId);
        }
        if (voiceState.audioContext && voiceState.audioContext.state !== 'closed') {
          voiceState.audioContext.close().catch(() => { });
        }
        voiceState.audioContext = null;
        store.set({ activeVoiceChannelId: null });
        playSoundEffect('disconnect');
        renderChatMain();
      }

      async function joinVoiceChannel(channelId) {
        const channel = findChannelById(channelId);
        if (!channel || !['voice', 'dm'].includes(channel.type)) {
          toast('This channel does not support voice', 'error');
          return;
        }
        if (!supportsVoiceCalling()) {
          toast('Voice calling is not supported in this browser', 'error');
          return;
        }

        if (idsEqual(voiceState.joinedChannelId, channelId)) return;
        if (voiceState.joinedChannelId) {
          await leaveVoiceChannel(true);
        }

        try {
          await ensureLocalVoiceStream();
        } catch (err) {
          toast('Microphone permission is required for voice', 'error');
          return;
        }

        voiceState.joinedChannelId = idKey(channelId);
        store.set({ activeVoiceChannelId: idKey(channelId) });
        playSoundEffect('connect');

        if (socket && store.state.wsConnected) {
          socket.send({ action: 'join_voice', channel_id: idKey(channelId) });
          socket.send({ action: 'voice.status', channel_id: idKey(channelId) });
        }
        startVoiceStatusPolling(channelId);

        renderChatMain();
      }

      function toggleVoiceMute() {
        if (!voiceState.localStream) return;
        voiceState.muted = !voiceState.muted;
        for (const track of voiceState.localStream.getAudioTracks()) {
          track.enabled = !voiceState.muted;
        }
        if (voiceState.muted) setVoiceSpeaking(store.state.user?.id, false);
        refreshVoiceSpeakingUI();
        renderChatMain();
      }

      function requestVoiceStatus(channelId) {
        if (!socket || !store.state.wsConnected) return;
        socket.send({ action: 'voice.status', channel_id: idKey(channelId) });
      }

      // ── Bootstrap ─────────────────────────────────────────────────────────────
      async function init() {
        renderIconSidebar();
        renderChanSidebar();
        renderChatMain();
        renderMemberSidebar();
        store.set({ initialSidebarLoading: true });

        try {
          const [serverList, dmList, readStates] = await Promise.all([
            servers.list(),
            dms.list().catch(() => []),
            users.readStates().catch(() => []),
          ]);
          const channelEntries = await Promise.all(
            (serverList || []).map(async (server) => [server.id, await channels.list(server.id).catch(() => [])])
          );
          store.set({
            servers: serverList || [],
            dmList: dmList || [],
            channels: Object.fromEntries(channelEntries),
            readStates: hydrateReadStates(readStates || []),
            initialSidebarLoading: false,
          });

          renderIconSidebar();
          renderChanSidebar();

          const pendingInvite = inviteCodeFromLocation();
          if (pendingInvite) {
            try {
              const joinedServer = await joinServerWithInvite(pendingInvite);
              clearInviteLocation();
              toast(`Joined ${joinedServer.name}`, 'success');
            } catch (inviteError) {
              clearInviteLocation();
              toast(inviteError?.message || 'Invite link is invalid', 'error');
            }
          }

          if (!store.state.activeServerId && store.state.servers?.length) {
            await selectServer(store.state.servers[0].id);
          }
        } catch {
          store.set({ initialSidebarLoading: false });
        }

        startSocket();
      }

      // ── WebSocket ─────────────────────────────────────────────────────────────
      function startSocket() {
        socketSubscriptions.clear();
        socket = new WyvernSocket(handleWsEvent);
        socket.connect();
      }

      function handleWsEvent(event) {
        if (event.type === 'connected') {
          store.set({ wsConnected: true });
          renderChanSidebar();
          syncChannelSubscriptions();
          if (store.state.user?.presence && store.state.user.presence !== 'online') {
            socket.send({ action: 'presence', status: store.state.user.presence });
          }
          if (voiceState.joinedChannelId) {
            socket.send({ action: 'join_voice', channel_id: idKey(voiceState.joinedChannelId) });
            socket.send({ action: 'voice.status', channel_id: idKey(voiceState.joinedChannelId) });
            startVoiceStatusPolling(voiceState.joinedChannelId);
          }
        }
        if (event.type === 'disconnected') {
          store.set({ wsConnected: false });
          socketSubscriptions.clear();
          stopVoiceStatusPolling();
          renderChanSidebar();
        }

        switch (event.event) {
          case 'presence.updated':
            applyPresenceLocally(event.data?.user_id || store.state.user?.id, event.data?.status || 'online');
            renderTypingBarUi();
            break;
          case 'user.updated':
            if (event.data?.id) {
              mergeUserLocally(event.data);
            }
            break;
          case 'user.deleted':
            if (event.data?.id) {
              removeUserLocally(event.data.id);
            }
            break;
          case 'server.created':
          case 'server.updated':
            if (event.data?.id) {
              upsertServerLocally(event.data);
              if (communityHubController) void communityHubController.refresh();
            }
            break;
          case 'server.deleted':
            if (event.data?.id || event.data?.server_id) {
              removeServerLocally(event.data?.id || event.data?.server_id);
              if (communityHubController) void communityHubController.refresh();
            }
            break;
          case 'server.member.created':
          case 'server.member.updated': {
            const member = event.data?.member || event.data || null;
            const user = event.data?.user || null;
            const server = event.data?.server || null;
            if (member) {
              upsertMemberLocally(member, user, server);
              if (server?.id && idsEqual(event.data?.user_id || member.user_id, store.state.user?.id)) {
                upsertServerLocally(server);
              }
              if (communityHubController) void communityHubController.refresh();
            }
            break;
          }
          case 'server.member.deleted': {
            const member = event.data?.member || event.data || null;
            const serverId = idKey(event.data?.server_id || member?.server_id);
            const userId = idKey(event.data?.user_id || member?.user_id);
            if (serverId && userId) {
              removeMemberLocally(serverId, userId);
              if (serverId && idsEqual(userId, store.state.user?.id) && event.data?.server?.id) {
                removeServerLocally(event.data.server.id);
              }
              if (communityHubController) void communityHubController.refresh();
            }
            break;
          }
          case 'channel.created':
          case 'channel.updated': {
            const channel = event.data || null;
            if (!channel?.id) break;
            if (String(channel.type || '').toLowerCase() === 'dm') {
              if (Array.isArray(channel.participants) && channel.participants.length) {
                upsertDmInState(channel);
                renderIconSidebar();
                if (store.state.sidebarMode === 'dms') renderChanSidebar();
              } else {
                void hydrateDmFromChannel(channel.id);
              }
            } else {
              upsertChannelLocally(channel);
            }
            if (communityHubController) void communityHubController.refresh();
            break;
          }
          case 'channel.deleted': {
            const channelId = event.data?.id || event.data?.channel_id || event.channel_id;
            if (channelId) {
              if (String(event.data?.type || '').toLowerCase() === 'dm') {
                removeDmFromState(channelId);
                removeVoiceParticipantsEntry(channelId);
                if (idsEqual(voiceState.joinedChannelId, channelId)) {
                  void leaveVoiceChannel(false);
                }
                renderIconSidebar();
                renderChanSidebar();
                renderMemberSidebar();
                renderChatMain();
              } else {
                removeChannelLocally(channelId);
              }
              if (communityHubController) void communityHubController.refresh();
            }
            break;
          }
          case 'message.created':
            if (msgListEl && idsEqual(event.data?.channel_id || event.channel_id, store.state.activeChannelId)) {
              msgListEl.addMessage(event.data);
            }
            if (!idsEqual(event.data?.author_id, store.state.user?.id)) {
              void (async () => {
                await ensureIncomingDmVisible(event.data, event.channel || event.data?.channel || null);
                await notifyIncomingMessage(event.data);
              })();
            }
            rememberLatestMessage(event.data);
            if (idsEqual(event.data?.channel_id || event.channel_id, store.state.activeChannelId)) {
              if (msgListEl?.isNearBottom?.() || idsEqual(event.data?.author_id, store.state.user?.id)) {
                void markChannelRead(event.data?.channel_id || event.channel_id, event.data?.id);
              }
            } else {
              renderIconSidebar();
              renderChanSidebar();
            }
            if (communityHubController) void communityHubController.refresh();
            break;
          case 'message.updated':
            if (msgListEl && idsEqual(event.data?.channel_id || event.channel_id, store.state.activeChannelId)) {
              msgListEl.updateMessage(event.data);
            }
            if (communityHubController) void communityHubController.refresh();
            break;
          case 'message.deleted':
            if (msgListEl && idsEqual(event.data?.channel_id || event.channel_id, store.state.activeChannelId)) {
              msgListEl.deleteMessage(event.data?.id || event.data?.message_id);
            }
            if (communityHubController) void communityHubController.refresh();
            break;
          case 'reaction.added':
          case 'reaction.removed':
            if (msgListEl && idsEqual(event.data?.channel_id || event.channel_id, store.state.activeChannelId)) {
              msgListEl.addReaction(event.data);
            }
            if (communityHubController) void communityHubController.refresh();
            break;
          case 'workspace.updated':
            if (communityHubController?.handleWorkspaceUpdate) {
              communityHubController.handleWorkspaceUpdate(event.data || {});
            } else if (communityHubController) {
              void communityHubController.refresh();
            }
            break;
          case 'server.activity.created':
            if (communityHubController?.handleActivityUpdate) {
              communityHubController.handleActivityUpdate(event.data || {});
            } else if (communityHubController) {
              void communityHubController.refresh();
            }
            break;
          case 'dm.created': {
            if (event.data?.id) {
              upsertDmInState(event.data);
              renderIconSidebar();
              if (store.state.sidebarMode === 'dms') {
                renderChanSidebar();
              }
              if (communityHubController) void communityHubController.refresh();
            }
            break;
          }
          case 'dm.deleted': {
            const channelId = event.data?.id || event.data?.channel_id || event.channel_id;
            if (channelId) {
              removeDmFromState(channelId);
              removeVoiceParticipantsEntry(channelId);
              if (idsEqual(voiceState.joinedChannelId, channelId)) {
                void leaveVoiceChannel(false);
              }
              renderIconSidebar();
              renderChanSidebar();
              renderMemberSidebar();
              renderChatMain();
              if (communityHubController) void communityHubController.refresh();
            }
            break;
          }
          case 'voice.participants': {
            const channelId = idKey(event.data?.channel_id || event.channel_id);
            const userIds = Array.isArray(event.data?.user_ids) ? event.data.user_ids : [];
            if (Array.isArray(event.data?.users)) {
              for (const user of event.data.users) {
                if (user?.id) mergeUserLocally(user);
              }
            }
            if (channelId) {
              void syncVoicePeers(channelId, userIds);
            }
            break;
          }
          case 'typing.updated':
            setTypingUsersForChannel(event.data?.channel_id || event.channel_id, event.data?.user_ids || []);
            for (const userId of (event.data?.user_ids || [])) {
              if (userId && !userCache.has(userId)) {
                getUserCached(userId).then(() => renderTypingBarUi()).catch(() => { });
              }
            }
            renderTypingBarUi();
            break;
          case 'call.signal':
            void handleIncomingCallSignal(event.data || {});
            break;
        }
      }

      async function hydrateMembers(members) {
        const hydrated = [];
        for (const m of (members || [])) {
          const user = m.user || await getUserCached(m.user_id);
          hydrated.push({ ...m, user: user || m.user || null });
        }
        return hydrated;
      }

      async function refreshServerMembers(serverId) {
        const normalizedServerId = idKey(serverId);
        if (!normalizedServerId) return [];
        try {
          const fresh = await servers.members(normalizedServerId);
          const hydrated = await hydrateMembers(fresh || []);
          store.set({
            members: {
              ...store.state.members,
              [normalizedServerId]: hydrated,
            },
          });
          renderMemberSidebar();
          return hydrated;
        } catch (error) {
          toast(error?.message || 'Could not refresh members', 'error');
          return [];
        }
      }

      // ── Server selection ──────────────────────────────────────────────────────
      async function selectServer(serverId) {
        if (voiceState.joinedChannelId) {
          await leaveVoiceChannel(true);
        }
        store.set({ activeServerId: serverId, activeChannelId: null, sidebarMode: 'servers' });
        msgListEl = null;

        try {
          const [chans, mems] = await Promise.all([
            channels.list(serverId),
            servers.members(serverId).catch(() => [])
          ]);
          const hydratedMems = await hydrateMembers(mems || []);
          const chanMap = { ...store.state.channels, [serverId]: chans || [] };
          const memMap = { ...store.state.members, [serverId]: hydratedMems };
          store.set({ channels: chanMap, members: memMap });
          syncChannelSubscriptions();

          renderIconSidebar();
          renderChanSidebar();
          renderMemberSidebar();
          renderChatMain();
          window.requestAnimationFrame(() => msgListEl?.jumpToBottom?.());

          // auto-select first text channel
          const first = (chans || []).find(c => c.type === 'text') || (chans || [])[0];
          if (first) await selectChannel(first.id);
        } catch { }
      }

      async function selectChannel(channelId) {
        if (voiceState.joinedChannelId && !idsEqual(voiceState.joinedChannelId, channelId)) {
          await leaveVoiceChannel(true);
        }
        store.set({ activeChannelId: channelId, activeDmId: null });
        syncChannelSubscriptions();
        const channel = findChannelById(channelId);
        if (channel?.type === 'voice') requestVoiceStatus(channelId);
        renderChanSidebar();
        renderChatMain();
        window.requestAnimationFrame(() => msgListEl?.jumpToBottom?.());
      }

      async function selectDm(channelId) {
        if (voiceState.joinedChannelId && !idsEqual(voiceState.joinedChannelId, channelId)) {
          await leaveVoiceChannel(true);
        }
        store.set({ activeChannelId: channelId, activeDmId: channelId, activeServerId: null });
        syncChannelSubscriptions();
        requestVoiceStatus(channelId);
        renderChanSidebar();
        renderMemberSidebar();
        renderChatMain();
        window.requestAnimationFrame(() => msgListEl?.jumpToBottom?.());
      }

      function dmDisplayName(dm) {
        const other = dm?.participants?.find((p) => !idsEqual(p.id, store.state.user?.id));
        if (other) return displayName(other);
        if (dm?.name) return dm.name;
        if (dm?.id) return `DM ${dm.id}`;
        return 'DM';
      }

      function upsertDmInState(dm) {
        if (!dm?.id) return;
        if (Array.isArray(dm.participants)) {
          for (const participant of dm.participants) {
            if (participant?.id) {
              userCache.set(idKey(participant.id), { ...(userCache.get(idKey(participant.id)) || {}), ...participant, id: idKey(participant.id) });
            }
          }
        }
        const existing = store.state.dmList || [];
        const deduped = [dm, ...existing.filter((item) => !idsEqual(item.id, dm.id))];
        store.set({ dmList: deduped });
        syncChannelSubscriptions();
        return dm;
      }

      async function hydrateDmFromChannel(channelId) {
        const dm = await dms.get(channelId).catch(() => null);
        if (!dm?.id) return null;
        upsertDmInState(dm);
        renderIconSidebar();
        if (store.state.sidebarMode === 'dms') {
          renderChanSidebar();
        }
        renderMemberSidebar();
        return dm;
      }

      async function ensureIncomingDmVisible(message, channel = null) {
        const channelId = idKey(channel?.id || message?.channel_id);
        if (!channelId) return null;

        const known = getChannelFromState(channelId);
        if (String(known?.type || '').toLowerCase() === 'dm') {
          return known;
        }

        if (String(channel?.type || '').toLowerCase() === 'dm') {
          const dm = upsertDmInState(channel);
          renderIconSidebar();
          if (store.state.sidebarMode === 'dms') {
            renderChanSidebar();
          }
          renderMemberSidebar();
          return dm || channel;
        }

        return hydrateDmFromChannel(channelId);
      }

      function removeDmFromState(channelId) {
        const next = (store.state.dmList || []).filter((item) => !idsEqual(item.id, channelId));
        const nextState = { dmList: next };
        if (idsEqual(store.state.activeChannelId, channelId)) {
          nextState.activeChannelId = null;
          nextState.activeDmId = null;
        }
        store.set(nextState);
        syncChannelSubscriptions();
      }

      async function joinServerWithInvite(rawInput) {
        const code = parseInviteCode(rawInput || '');
        if (!code) throw new Error('Invalid invite code');

        const joined = await servers.joinByInvite(code);
        const joinedServer = joined?.server;
        if (!joinedServer?.id) throw new Error('Invalid invite response');

        const existing = store.state.servers || [];
        const nextServers = existing.some((item) => idsEqual(item.id, joinedServer.id))
          ? existing.map((item) => idsEqual(item.id, joinedServer.id) ? joinedServer : item)
          : [joinedServer, ...existing];

        store.set({ servers: nextServers });
        renderIconSidebar();
        await selectServer(joinedServer.id);
        return joinedServer;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // RENDER FUNCTIONS
      // ─────────────────────────────────────────────────────────────────────────

      function renderIconSidebar() {
        const modernShell = shellRefreshEnabled();
        const { servers: svrs, activeServerId, sidebarMode, activeChannelId, dmList, initialSidebarLoading } = store.state;
        iconSidebar.innerHTML = '';

        if (initialSidebarLoading && !(svrs || []).length && !(dmList || []).length) {
          iconSidebar.appendChild(el('div', { class: 'sidebar-skeleton sidebar-skeleton-rail' }));
          iconSidebar.appendChild(el('div', { class: 'sidebar-skeleton sidebar-skeleton-rail tall' }));
          iconSidebar.appendChild(el('div', { class: 'sidebar-skeleton sidebar-skeleton-rail' }));
          return;
        }

        if (!modernShell) {
          const logo = el('div', {
            class: `sidebar-logo full-icon${sidebarMode === 'dms' ? ' active' : ''}`,
            title: 'Direct Messages',
            onClick: async () => {
              store.set({ sidebarMode: 'dms', activeServerId: null });
              const list = await dms.list().catch(() => []);
              store.set({ dmList: list || [] });
              renderIconSidebar();
              renderChanSidebar();
              renderMemberSidebar();
              renderChatMain();
            }
          });
          logo.appendChild(el('img', { src: WYVERN_SECTION_LOGO_URL, alt: 'Wyvern logo' }));
          iconSidebar.appendChild(logo);
          iconSidebar.appendChild(el('div', { class: 'sidebar-sep' }));

          for (const dm of dmList || []) {
            const label = dmDisplayName(dm);
            const other = dm?.participants?.find((p) => !idsEqual(p.id, store.state.user?.id)) || null;
            const dmPill = el('div', {
              class: `server-pill${sidebarMode === 'dms' && idsEqual(dm.id, activeChannelId) ? ' active' : ''}`,
              title: label,
              onClick: async () => {
                store.set({ sidebarMode: 'dms', activeServerId: null });
                renderChanSidebar();
                renderMemberSidebar();
                await selectDm(dm.id);
              }
            });
            if (other?.avatar) {
              dmPill.appendChild(el('img', { class: 'server-pill-img', src: other.avatar, alt: label }));
            } else {
              dmPill.textContent = initials(label);
              dmPill.style.background = avatarColor(label);
            }
            iconSidebar.appendChild(dmPill);
          }

          iconSidebar.appendChild(el('div', { class: 'sidebar-sep' }));

          for (const srv of svrs) {
            const pill = el('div', {
              class: `server-pill${idsEqual(srv.id, activeServerId) ? ' active' : ''}`,
              title: srv.name,
              onClick: () => selectServer(srv.id),
            });
            if (srv.icon) {
              pill.appendChild(el('img', { class: 'server-pill-img', src: srv.icon, alt: srv.name || 'server' }));
            } else {
              pill.textContent = initials(srv.name);
              pill.style.background = avatarColor(srv.name);
            }
            iconSidebar.appendChild(pill);
          }

          const addBtn = el('div', {
            class: 'server-pill-add',
            title: 'Create Server',
            onClick: () => showSettingsModal({
              title: 'Create Server',
              subtitle: 'Set up a name and icon for your server.',
              nameLabel: 'Server Name',
              namePlaceholder: 'My Awesome Server',
              initialName: '',
              iconLabel: 'Server Icon',
              initialIcon: null,
              detailsLabel: 'Server Description',
              detailsPlaceholder: 'Tell people what your server is about...',
              initialDetails: '',
              detailsMaxLength: 512,
              toggleLabel: 'Show In Server Directory',
              toggleHelp: 'Allow anyone to discover this server in the public directory.',
              initialToggle: false,
              saveLabel: 'Create Server',
              requireName: true,
              onSave: async ({ name, icon, details, toggle }) => {
                const srv = await servers.create(name, icon, details || null, !!toggle);
                store.set({ servers: [...store.state.servers, srv] });
                await selectServer(srv.id);
              },
            })
          }, heroIcon('plus', { size: 20 }));
          iconSidebar.appendChild(addBtn);

          const joinBtn = el('div', {
            class: 'server-pill-add',
            title: 'Join Server via Invite',
            onClick: () => showTextEntryModal({
              title: 'Join Server',
              subtitle: 'Paste an invite code or a full invite URL to join a server.',
              label: 'Invite',
              placeholder: 'wyvern.gg/abc123 or abc123',
              confirmLabel: 'Join Server',
              onSubmit: async (raw) => {
                if (!raw) throw new Error('Enter an invite code or link.');
                const joinedServer = await joinServerWithInvite(raw);
                toast(`Joined ${joinedServer.name}`, 'success');
              },
            })
          }, heroIcon('arrowRightOnRectangle', { size: 20 }));
          iconSidebar.appendChild(joinBtn);
          return;
        }

        function buildSidebarVisual({ label, avatar = null, icon = null }) {
          const visual = el('div', { class: `sidebar-nav-avatar${icon ? ' icon' : ''}` });
          if (avatar) {
            visual.appendChild(el('img', { src: avatar, alt: label }));
          } else if (icon) {
            visual.appendChild(icon);
          } else {
            visual.textContent = initials(label);
            visual.style.background = avatarColor(label);
          }
          return visual;
        }

        function createSidebarRow({
          label,
          meta = '',
          title = label,
          active = false,
          avatar = null,
          icon = null,
          onClick,
        }) {
          const row = el('button', {
            class: `sidebar-nav-row${active ? ' active' : ''}`,
            type: 'button',
            title,
            'aria-label': title,
            onClick,
          });
          const copy = el('div', { class: 'sidebar-nav-copy' },
            el('div', { class: 'sidebar-nav-title' }, label)
          );
          if (meta) {
            copy.appendChild(el('div', { class: 'sidebar-nav-meta' }, meta));
          }
          row.append(buildSidebarVisual({ label, avatar, icon }), copy);
          return row;
        }

        function createRailButton({
          label,
          title = label,
          active = false,
          avatar = null,
          icon = null,
          onClick,
          unread = false,
        }) {
          const button = el('button', {
            class: `command-rail-btn${active ? ' active' : ''}`,
            type: 'button',
            title,
            'aria-label': title,
            onClick,
          }, buildSidebarVisual({ label, avatar, icon }));
          if (unread) {
            button.appendChild(el('span', { class: 'command-rail-unread' }));
          }
          return button;
        }

        if (isUiA()) {
          iconSidebar.classList.add('is-command-rail');
          const dmHomeActive = sidebarMode === 'dms' && !activeServerId;
          const topGroup = el('div', { class: 'command-rail-group' });
          topGroup.appendChild(
            el('button', {
              class: `command-rail-brand${dmHomeActive ? ' active' : ''}`,
              type: 'button',
              title: 'Open Direct Messages',
              'aria-label': 'Open Direct Messages',
              onClick: async () => {
                store.set({ sidebarMode: 'dms', activeServerId: null, activeChannelId: null });
                const list = await dms.list().catch(() => []);
                store.set({ dmList: list || [] });
                renderIconSidebar();
                renderChanSidebar();
                renderMemberSidebar();
                renderChatMain();
              },
            },
              el('img', { src: WYVERN_SECTION_LOGO_URL, alt: 'Wyvern logo' }),
            )
          );
          if (communityToolsEnabled()) {
            topGroup.appendChild(createRailButton({
              label: 'Community Hub',
              title: 'Open Community Hub',
              active: sidebarMode === 'community',
              icon: heroIcon('squares', { size: 18 }),
              onClick: () => openCommunityHubPage('discover'),
            }));
          }
          iconSidebar.appendChild(topGroup);

          const serverGroup = el('div', { class: 'command-rail-stack' });
          serverGroup.appendChild(createRailButton({
            label: 'Direct Messages',
            title: 'Direct Messages',
            active: dmHomeActive,
            icon: heroIcon('chatBubble', { size: 18 }),
            unread: (store.state.dmList || []).some((dm) => channelHasUnread(dm.id)),
            onClick: async () => {
              store.set({ sidebarMode: 'dms', activeServerId: null });
              const list = await dms.list().catch(() => []);
              store.set({ dmList: list || [] });
              renderIconSidebar();
              renderChanSidebar();
              renderMemberSidebar();
              renderChatMain();
            },
          }));
          for (const srv of svrs) {
            serverGroup.appendChild(createRailButton({
              label: srv.name,
              title: srv.name,
              active: idsEqual(srv.id, activeServerId),
              avatar: srv.icon || null,
              unread: ((store.state.channels?.[srv.id] || []).some((channel) => channelHasUnread(channel.id))),
              onClick: () => selectServer(srv.id),
            }));
          }
          iconSidebar.appendChild(serverGroup);
          iconSidebar.appendChild(el('div', { class: 'sidebar-flex-spacer' }));

          const footer = el('div', { class: 'command-rail-group command-rail-footer' });
          footer.appendChild(createRailButton({
            label: 'Create Server',
            title: 'Create Server',
            icon: heroIcon('plus', { size: 18 }),
            onClick: () => showSettingsModal({
              title: 'Create Server',
              subtitle: 'Set up a name and icon for your server.',
              nameLabel: 'Server Name',
              namePlaceholder: 'My Awesome Server',
              initialName: '',
              iconLabel: 'Server Icon',
              initialIcon: null,
              detailsLabel: 'Server Description',
              detailsPlaceholder: 'Tell people what your server is about...',
              initialDetails: '',
              detailsMaxLength: 512,
              toggleLabel: 'Show In Server Directory',
              toggleHelp: 'Allow anyone to discover this server in the public directory.',
              initialToggle: false,
              saveLabel: 'Create Server',
              requireName: true,
              onSave: async ({ name, icon, details, toggle }) => {
                const srv = await servers.create(name, icon, details || null, !!toggle);
                store.set({ servers: [...store.state.servers, srv] });
                await selectServer(srv.id);
              },
            }),
          }));
          footer.appendChild(createRailButton({
            label: 'Join Server',
            title: 'Join Server',
            icon: heroIcon('arrowRightOnRectangle', { size: 18 }),
            onClick: () => showTextEntryModal({
              title: 'Join Server',
              subtitle: 'Paste an invite code or full invite link to enter a new space.',
              label: 'Invite',
              placeholder: 'wyvern.gg/abc123 or abc123',
              confirmLabel: 'Join Server',
              onSubmit: async (value) => {
                if (!value) throw new Error('Enter an invite code or link.');
                const joinedServer = await joinServerWithInvite(value);
                toast(`Joined ${joinedServer.name}`, 'success');
              },
            }),
          }));
          footer.appendChild(createRailButton({
            label: 'Settings',
            title: 'Open Settings',
            icon: heroIcon('cog', { size: 18 }),
            onClick: () => showSettingsHub(defaultSettingsSection()),
          }));
          iconSidebar.appendChild(footer);
          return;
        }

        const dmHomeActive = sidebarMode === 'dms' && !activeServerId && !idKey(activeChannelId);
        const brandRow = el('button', {
          class: `sidebar-brand-row${dmHomeActive ? ' active' : ''}`,
          type: 'button',
          title: 'Direct Messages',
          onClick: async () => {
            store.set({ sidebarMode: 'dms', activeServerId: null, activeChannelId: null });
            const list = await dms.list().catch(() => []);
            store.set({ dmList: list || [] });
            renderIconSidebar();
            renderChanSidebar();
            renderMemberSidebar();
            renderChatMain();
          }
        },
          el('div', { class: 'sidebar-brand-mark' },
            el('img', { src: WYVERN_SECTION_LOGO_URL, alt: 'Wyvern logo' })
          ),
          el('div', { class: 'sidebar-brand-copy' },
            el('div', { class: 'sidebar-brand-title' }, 'Wyvern'),
            el('div', { class: 'sidebar-brand-subtitle' }, 'Direct messages and spaces')
          )
        );
        iconSidebar.appendChild(brandRow);

        if (modernShell) {
          const utilitySection = el('div', { class: 'sidebar-section' });
          if (communityToolsEnabled()) {
            utilitySection.appendChild(createSidebarRow({
              label: 'Community Hub',
              meta: 'Discover, search, pins, and workspace',
              active: sidebarMode === 'community',
              icon: heroIcon('squares', { size: 18 }),
              onClick: () => openCommunityHubPage('discover'),
            }));
          }
          utilitySection.appendChild(createSidebarRow({
            label: 'Settings',
            meta: 'Profile, status, and developer controls',
            icon: heroIcon('cog', { size: 18 }),
            onClick: () => showSettingsHub(defaultSettingsSection()),
          }));
          iconSidebar.appendChild(utilitySection);
        }

        const dmSection = el('div', { class: 'sidebar-section' });
        dmSection.appendChild(el('div', { class: 'sidebar-section-title' }, 'Direct Messages'));
        for (const dm of dmList || []) {
          const label = dmDisplayName(dm);
          const other = dm?.participants?.find((p) => !idsEqual(p.id, store.state.user?.id)) || null;
          const meta = other?.presence
            ? presenceLabel(other.presence)
            : ((dm?.participants?.length || 0) > 2 ? 'Group conversation' : 'Direct message');
          dmSection.appendChild(createSidebarRow({
            label,
            meta,
            title: label,
            active: sidebarMode === 'dms' && idsEqual(dm.id, activeChannelId),
            avatar: other?.avatar || null,
            onClick: async () => {
              store.set({ sidebarMode: 'dms', activeServerId: null });
              renderChanSidebar();
              renderMemberSidebar();
              await selectDm(dm.id);
            },
          }));
        }
        iconSidebar.appendChild(dmSection);

        const serverSection = el('div', { class: 'sidebar-section' });
        serverSection.appendChild(el('div', { class: 'sidebar-section-title' }, 'Servers'));
        for (const srv of svrs) {
          serverSection.appendChild(createSidebarRow({
            label: srv.name,
            meta: idsEqual(srv.id, activeServerId) ? 'Active server' : (srv.description || 'Server'),
            title: srv.name,
            active: idsEqual(srv.id, activeServerId),
            avatar: srv.icon || null,
            onClick: () => selectServer(srv.id),
          }));
        }
        iconSidebar.appendChild(serverSection);

        iconSidebar.appendChild(el('div', { class: 'sidebar-flex-spacer' }));

        const footerSection = el('div', { class: 'sidebar-section sidebar-footer' });
        footerSection.appendChild(el('div', { class: 'sidebar-section-title' }, 'Actions'));
        footerSection.appendChild(createSidebarRow({
          label: 'Create Server',
          meta: 'Start a new community space',
          icon: heroIcon('plus', { size: 18 }),
          onClick: () => showSettingsModal({
            title: 'Create Server',
            subtitle: 'Set up a name and icon for your server.',
            nameLabel: 'Server Name',
            namePlaceholder: 'My Awesome Server',
            initialName: '',
            iconLabel: 'Server Icon',
            initialIcon: null,
            detailsLabel: 'Server Description',
            detailsPlaceholder: 'Tell people what your server is about...',
            initialDetails: '',
            detailsMaxLength: 512,
            toggleLabel: 'Show In Server Directory',
            toggleHelp: 'Allow anyone to discover this server in the public directory.',
            initialToggle: false,
            saveLabel: 'Create Server',
            requireName: true,
            onSave: async ({ name, icon, details, toggle }) => {
              const srv = await servers.create(name, icon, details || null, !!toggle);
              store.set({ servers: [...store.state.servers, srv] });
              await selectServer(srv.id);
            },
          }),
        }));
        footerSection.appendChild(createSidebarRow({
          label: 'Join Server',
          meta: 'Paste an invite code or link',
          icon: heroIcon('arrowRightOnRectangle', { size: 18 }),
          onClick: () => showTextEntryModal({
            title: 'Join Server',
            subtitle: 'Paste an invite code or a full invite URL to join a server.',
            label: 'Invite',
            placeholder: 'wyvern.gg/abc123 or abc123',
            confirmLabel: 'Join Server',
            onSubmit: async (raw) => {
              if (!raw) throw new Error('Enter an invite code or link.');
              const joinedServer = await joinServerWithInvite(raw);
              toast(`Joined ${joinedServer.name}`, 'success');
            },
          }),
        }));
        iconSidebar.appendChild(footerSection);
      }

      function renderChanSidebar() {
        const modernShell = shellRefreshEnabled();
        const { sidebarMode, activeServerId, activeChannelId, channels: chansMap, servers: svrs, dmList, wsConnected, initialSidebarLoading } = store.state;
        chanSidebar.innerHTML = '';
        const collapseForCommunity = modernShell && sidebarMode === 'community';
        chanSidebar.hidden = collapseForCommunity;
        chanSidebar.classList.toggle('is-collapsed', collapseForCommunity);

        if (collapseForCommunity) {
          return;
        }

        if (sidebarMode === 'dms') {
          renderDmSidebar();
          return;
        }

        if (initialSidebarLoading && !activeServerId) {
          chanSidebar.appendChild(el('div', { class: 'sidebar-skeleton sidebar-skeleton-panel tall' }));
          chanSidebar.appendChild(el('div', { class: 'sidebar-skeleton sidebar-skeleton-panel' }));
          return;
        }

        const srv = svrs.find((s) => idsEqual(s.id, activeServerId));
        const chans = (activeServerId && chansMap[activeServerId]) || [];

        // Server name bar
        const titleWrap = el('div', { class: 'server-title-wrap' });
        if (srv?.icon) {
          titleWrap.appendChild(el('img', { class: 'server-title-icon', src: srv.icon, alt: srv.name || 'server' }));
        }
        titleWrap.appendChild(el('h2', {}, srv?.name || 'Wyvern'));

        const rightActions = el('div', { class: 'topbar-actions' });
        if (activeServerId) {
          const inviteBtn = el('button', {
            class: 'topbar-btn',
            title: 'Copy Invite Link',
            'aria-label': 'Copy Invite Link',
            onClick: async (e) => {
              e.stopPropagation();
              try {
                const invite = await servers.createInvite(activeServerId);
                const invitePath = invite?.invite_path || `/invite/${invite?.code || ''}`;
                const inviteUrl = `${location.origin}${invitePath}`;
                if (navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(inviteUrl);
                  toast('Invite link copied', 'success');
                } else {
                  prompt('Copy invite link', inviteUrl);
                }
              } catch (err) {
                toast(err?.message || 'Failed to create invite link', 'error');
              }
            }
          }, heroIcon('link', { size: 18 }));
          rightActions.appendChild(inviteBtn);

          const editServerBtn = el('button', {
            class: 'topbar-btn',
            title: 'Edit Server',
            'aria-label': 'Edit Server',
            onClick: async (e) => {
              e.stopPropagation();
              showServerSettingsHub(activeServerId, 'overview');
            }
          }, heroIcon('cog', { size: 18 }));
          rightActions.appendChild(editServerBtn);
        }
        if (!communityToolsEnabled()) {
          rightActions.appendChild(el('button', {
            class: 'topbar-btn',
            title: 'User Directory',
            'aria-label': 'Open User Directory',
            onClick: (event) => {
              event.stopPropagation();
              showUserDirectoryModal({
                onOpenDm: async (dm) => {
                  upsertDmInState(dm);
                  renderIconSidebar();
                  renderChanSidebar();
                  await selectDm(dm.id);
                },
              });
            }
          }, heroIcon('userGroup', { size: 18 })));
          rightActions.appendChild(el('button', {
            class: 'topbar-btn',
            title: 'Server Directory',
            'aria-label': 'Open Server Directory',
            onClick: (event) => {
              event.stopPropagation();
              showServerDirectoryModal({
                onSelectServer: async (serverId) => {
                  renderIconSidebar();
                  await selectServer(serverId);
                },
              });
            }
          }, heroIcon('squares', { size: 18 })));
        }
        rightActions.appendChild(wsDot(wsConnected));

        const nameBar = el('div', { class: 'server-name-bar' }, titleWrap, rightActions);
        chanSidebar.appendChild(nameBar);

        const scroll = el('div', { class: 'channel-scroll' });

        // Group by category
        const categories = {};
        for (const ch of chans) {
          const cat = ch.category || 'channels';
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(ch);
        }

        for (const [catName, catChans] of Object.entries(categories)) {
          const catEl = el('div', { class: 'ch-category' },
            el('span', {}, catName.toUpperCase()),
            el('span', {
              class: 'cat-plus', onClick: (e) => {
                e.stopPropagation();
                showChannelCreateModal({
                  title: 'Create Channel',
                  placeholder: 'new-channel',
                  confirmLabel: 'Create',
                  onConfirm: async ({ name, type }) => {
                    try {
                      const ch = await channels.create(activeServerId, { name, type, category: catName });
                      const updated = [...(chansMap[activeServerId] || []), ch];
                      store.set({ channels: { ...chansMap, [activeServerId]: updated } });
                      renderChanSidebar();
                      await selectChannel(ch.id);
                    } catch (e) { toast(e?.message || 'Failed', 'error'); }
                  }
                });
              }
            }, heroIcon('plus', { size: 14 }))
          );
          scroll.appendChild(catEl);

          for (const ch of catChans) {
            const icon = ch.type === 'voice'
              ? heroIcon('speakerWave', { size: 16 })
              : heroIcon('hashtag', { size: 16 });
            const item = el('div', {
              class: `ch-item${idsEqual(ch.id, activeChannelId) ? ' active' : ''}`,
              onClick: () => selectChannel(ch.id)
            },
              el('span', { class: 'ch-hash' }, icon),
              el('span', { class: 'ch-name' }, ch.name),
              channelHasUnread(ch.id) ? el('span', { class: 'sidebar-unread-dot' }) : null
            );
            scroll.appendChild(item);
          }
        }

        if (!chans.length && activeServerId) {
          const addFirst = el('div', {
            class: 'ch-item', onClick: () => showChannelCreateModal({
              title: 'Create First Channel',
              placeholder: 'general',
              confirmLabel: 'Create',
              onConfirm: async ({ name, type }) => {
                try {
                  const ch = await channels.create(activeServerId, { name, type });
                  const updated = [ch];
                  store.set({ channels: { ...chansMap, [activeServerId]: updated } });
                  renderChanSidebar();
                  await selectChannel(ch.id);
                } catch { }
              }
            })
          },
            el('span', { class: 'ch-hash' }, heroIcon('plus', { size: 16 })),
            el('span', { class: 'ch-name' }, 'Create a channel')
          );
          scroll.appendChild(addFirst);
        }

        chanSidebar.appendChild(scroll);
        renderUserPanel(chanSidebar);
      }

      function renderDmSidebar() {
        const { dmList, activeChannelId } = store.state;
        const nameBar = el('div', { class: 'server-name-bar' }, el('h2', {}, 'Direct Messages'));
        chanSidebar.appendChild(nameBar);

        const list = el('div', { class: 'dm-list' });

        const newDm = el('div', {
          class: 'ch-item', onClick: () => showTextEntryModal({
            title: 'Start Direct Message',
            subtitle: 'Enter a username or full username tag to open a new private conversation.',
            label: 'Username',
            placeholder: 'username or username#1234',
            confirmLabel: 'Open DM',
            onSubmit: async (value) => {
              if (!value) throw new Error('Enter a username or username tag.');
              const recipient = await users.lookup(value.trim());
              const dm = await dms.create(recipient.id);
              if (!dm.participants?.length) {
                dm.participants = [store.state.user, recipient].filter(Boolean);
              }
              upsertDmInState(dm);
              renderChanSidebar();
              await selectDm(dm.id);
            },
          })
        },
          el('span', { class: 'ch-hash' }, heroIcon('plus', { size: 16 })),
          el('span', { class: 'ch-name' }, 'New Message')
        );
        list.appendChild(newDm);

        for (const dm of dmList) {
          const label = dmDisplayName(dm);
          const other = dm?.participants?.find((p) => !idsEqual(p.id, store.state.user?.id)) || null;
          const item = el('div', {
            class: `dm-item${idsEqual(dm.id, activeChannelId) ? ' active' : ''}`,
            onClick: () => selectDm(dm.id)
          },
            avatarEl(label, 'dm-av', 34, other?.avatar),
            el('span', { class: 'dm-name' }, label),
            channelHasUnread(dm.id) ? el('span', { class: 'sidebar-unread-dot' }) : null
          );
          list.appendChild(item);
        }

        chanSidebar.appendChild(list);
        renderUserPanel(chanSidebar);
      }

      function renderUserPanel(parent) {
        closeStatusMenu();
        const { user } = store.state;
        if (!user) return;

        const panel = el('div', { class: 'user-panel' });
        const currentPresence = user.presence || 'online';
        const label = displayName(user);
        const av = avatarEl(label, 'user-av', 32, user.avatar);
        av.style.background = avatarColor(label);
        const dot = el('div', { class: `status-ring s-${currentPresence}` });
        av.appendChild(dot);

        const info = el('div', { class: 'user-info-mini' },
          el('div', { class: 'uname' }, label),
          el('div', { class: 'utag' }, `${usernameTag(user)} • ${presenceLabel(currentPresence)}`)
        );

        const statusBtn = el('button', {
          class: 'panel-btn panel-status-btn',
          title: `Set status (${presenceLabel(currentPresence)})`,
          'aria-label': `Set status, currently ${presenceLabel(currentPresence)}`,
          onClick: (event) => {
            event.stopPropagation();
            showPresenceMenu(event.currentTarget);
          },
        }, el('span', { class: `status-dot-inline s-${currentPresence}` }));

        const editBtn = el('button', {
          class: 'panel-btn',
          title: 'Settings',
          'aria-label': 'Open Settings',
          onClick: () => showSettingsHub(defaultSettingsSection()),
        }, heroIcon('cog', { size: 16 }));

        const logoutBtn = el('button', {
          class: 'panel-btn', title: 'Sign Out', 'aria-label': 'Sign Out', onClick: async () => {
            await signOutUser();
          }
        }, heroIcon('arrowLeftOnRectangle', { size: 16 }));

        panel.append(av, info, statusBtn, editBtn, logoutBtn);
        parent.appendChild(panel);
      }

      function renderVoiceView(channel) {
        const myUserId = idKey(store.state.user?.id);
        const channelId = idKey(channel?.id);
        const activeCall = idsEqual(voiceState.joinedChannelId, channelId);
        const participants = Array.from(new Set((store.state.voiceParticipants?.[channelId] || []).map(idKey).filter(Boolean)));

        for (const userId of participants) {
          if (!userCache.has(userId)) {
            getUserCached(userId).then(() => {
              if (idsEqual(store.state.activeChannelId, channelId)) renderChatMain();
            }).catch(() => { });
          }
        }

        const hero = el('div', { class: 'voice-hero' },
          el('div', { class: 'voice-hero-title' }, channel?.name || 'Voice Channel'),
          el('div', { class: 'voice-hero-sub' }, activeCall ? 'You are connected to voice chat.' : 'Join this voice chat to start talking.'),
        );

        const controls = el('div', { class: 'voice-controls' });
        controls.appendChild(
          activeCall
            ? el('button', { class: 'voice-btn danger', onClick: () => leaveVoiceChannel(true) }, 'Leave Voice')
            : el('button', { class: 'voice-btn primary', onClick: () => joinVoiceChannel(channelId) }, 'Join Voice')
        );
        if (activeCall) {
          controls.appendChild(
            el('button', { class: 'voice-btn', onClick: () => toggleVoiceMute() }, voiceState.muted ? 'Unmute Mic' : 'Mute Mic')
          );
        }
        hero.appendChild(controls);

        const panel = el('div', { class: 'voice-panel' },
          el('div', { class: 'voice-panel-head' }, `Participants — ${participants.length}`),
        );
        const participantList = el('div', { class: 'voice-participants' });
        if (!participants.length) {
          participantList.appendChild(el('div', { class: 'voice-empty' }, 'No one is in this voice channel yet.'));
        } else {
          for (const userId of participants) {
            const user = userCache.get(userId);
            const label = displayName(user || { username: `User ${userId}` });
            const isSpeaking = voiceState.speakingUsers.has(userId);
            const row = el('div', {
              class: `voice-user${isSpeaking ? ' speaking' : ''}`,
              'data-user-id': String(userId),
            },
              avatarEl(label, 'member-av', 30, user?.avatar),
              el('span', { class: 'voice-user-name' }, label),
            );
            const speakingIndicator = el('span', { class: 'voice-speaking-indicator' },
              el('span', { class: 'voice-speaking-bars' },
                el('span'),
                el('span'),
                el('span'),
              ),
              el('span', {}, 'Speaking')
            );
            speakingIndicator.hidden = !isSpeaking;
            row.appendChild(speakingIndicator);
            if (idsEqual(userId, myUserId)) {
              row.appendChild(el('span', { class: 'voice-you' }, 'You'));
            }
            participantList.appendChild(row);
          }
        }
        panel.appendChild(participantList);

        return el('div', { class: 'voice-view' }, hero, panel);
      }

      function renderChatMain() {
        const { activeChannelId, activeServerId, channels: chansMap, sidebarMode } = store.state;
        chatMain.innerHTML = '';

        if (sidebarMode === 'community') {
          msgListEl = null;
          composerEl = null;
          const stage = el('div', { class: 'chat-main-stage community-hub-stage' });
          chatMain.appendChild(stage);
          showCommunityHub(store.state.communityHubTab || 'discover', { embedded: true, mount: stage });
          return;
        }

        if (!activeChannelId) {
          composerEl = null;
          const stage = el('div', { class: 'chat-main-stage' });
          stage.appendChild(el('div', { class: 'no-channel' },
            el('div', { class: 'nc-icon' }, heroIcon('chatBubble', { size: 64 })),
            el('h3', {}, 'Select a channel'),
            el('p', {}, communityToolsEnabled()
              ? 'Choose a channel from the sidebar to start chatting, or open Community Hub from the left rail.'
              : 'Choose a channel from the sidebar to start chatting')
          ));
          chatMain.appendChild(stage);
          return;
        }

        const channel = findChannelById(activeChannelId);
        const isDm = channel?.type === 'dm' || sidebarMode === 'dms';
        const isVoice = channel?.type === 'voice';
        const dmLabel = isDm ? dmDisplayName(channel) : null;
        const voiceActive = idsEqual(voiceState.joinedChannelId, activeChannelId);

        const topActions = el('div', { class: 'topbar-actions' });
        if (channel && ['voice', 'dm'].includes(channel.type)) {
          topActions.appendChild(
            el('button', {
              class: 'topbar-btn',
              title: voiceActive ? 'Leave Call' : 'Join Call',
              'aria-label': voiceActive ? 'Leave Call' : 'Join Call',
              onClick: async () => {
                if (voiceActive) await leaveVoiceChannel(true);
                else await joinVoiceChannel(activeChannelId);
              },
            }, voiceActive ? heroIcon('phoneXMark', { size: 18 }) : heroIcon('phone', { size: 18 }))
          );
        }
        if (store.state.user?.is_admin && featureFlagEnabled('admin_diagnostics_button')) {
          topActions.appendChild(adminCauseErrorButton());
        }
        const membersBtn = el('button', {
          class: `topbar-btn${store.state.memberSidebarOpen ? ' active' : ''}`,
          type: 'button',
          title: 'Members',
          'aria-label': store.state.memberSidebarOpen ? 'Hide Members Panel' : 'Show Members Panel',
          onClick: () => {
            store.set({ memberSidebarOpen: !store.state.memberSidebarOpen });
            renderMemberSidebar();
          },
        }, heroIcon('userGroup', { size: 18 }));
        topActions.append(
          membersBtn,
          el('button', { class: 'topbar-btn', title: 'Search', 'aria-label': 'Search' }, heroIcon('magnifyingGlass', { size: 18 }))
        );

        // Topbar
        const topbar = el('div', { class: 'chat-topbar' });
        const mobileMenuBtn = el('button', {
          class: 'mobile-menu-btn',
          title: 'Open Menu',
          'aria-label': 'Open Menu',
          onClick: () => store.set({ mobileSidebarOpen: !store.state.mobileSidebarOpen })
        }, heroIcon('bars3', { size: 24 }));

        topbar.append(
          el('div', { class: 'chat-topbar-copy' },
            mobileMenuBtn,
            el('span', { class: 'ch-icon' },
              isDm
                ? heroIcon('chatBubble', { size: 18 })
                : (isVoice ? heroIcon('speakerWave', { size: 18 }) : heroIcon('hashtag', { size: 18 }))
            ),
            el('div', { class: 'chat-topbar-titleblock' },
              el('h3', {}, isDm ? (dmLabel || 'Direct Message') : (channel?.name || 'channel')),
              el('span', { class: 'topbar-desc' }, channel?.description || (isVoice ? 'Voice Channel' : (isDm ? 'Direct Message' : 'Text Channel'))),
            ),
            topActions
          )
        );
        chatMain.appendChild(topbar);

        const stage = el('div', { class: 'chat-main-stage' });

        if (currentClientMode() === 'edge') {
          stage.appendChild(
            el('div', { class: 'edge-release-banner' },
              el('div', { class: 'edge-release-banner-copy' },
                el('div', { class: 'edge-release-banner-title' }, 'Edge Release Channel'),
                el('div', { class: 'edge-release-banner-text' }, 'You are viewing live Edge-only changes before they are promoted to Stable.')
              ),
              el('div', { class: 'edge-release-banner-pill' }, 'Edge Only')
            )
          );
        }

        if (isVoice) {
          msgListEl = null;
          composerEl = null;
          stage.appendChild(renderVoiceView(channel));
          chatMain.appendChild(stage);
          refreshVoiceSpeakingUI();
          return;
        }

        // Message list
        msgListEl = MessageList(activeChannelId, {
          onReply: (message) => composerEl?.setReplyTarget?.(message),
          onViewportChange: ({ atBottom }) => {
            scrollJumpBtn.hidden = atBottom;
          },
        });
        stage.appendChild(msgListEl);

        // Typing bar
        const typingBar = el('div', { class: 'typing-bar' });
        stage.appendChild(typingBar);
        renderTypingBarUi();

        const scrollJumpBtn = el('button', {
          class: 'scroll-jump-btn',
          type: 'button',
          hidden: true,
          title: 'Jump to latest messages',
          'aria-label': 'Jump to latest messages',
          onClick: () => msgListEl?.jumpToBottom?.(),
        }, heroIcon('arrowDown', { size: 16 }), el('span', {}, 'Latest'));
        stage.appendChild(scrollJumpBtn);

        // Input area
        composerEl = buildInput(activeChannelId);
        stage.appendChild(composerEl);
        chatMain.appendChild(stage);
      }

      function buildInput(channelId) {
        const area = el('div', { class: 'chat-input-area' });
        const replyBar = el('div', { class: 'composer-reply' });
        replyBar.hidden = true;
        const attachmentTray = el('div', { class: 'composer-attachments' });
        attachmentTray.hidden = true;
        const toolbar = el('div', { class: 'composer-toolbar' });
        const box = el('div', { class: 'chat-input-box' });
        const metaRow = el('div', { class: 'composer-meta-row' });
        const multilineHint = el('div', { class: 'composer-meta-copy' }, 'Shift + Enter for a new line');
        const charCount = el('div', { class: 'composer-char-count' }, '0 chars');
        let pendingAttachments = [];
        let replyTarget = null;
        let pendingNsfw = false;
        let typingTimer = null;
        let typingActive = false;

        // File upload
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files[0];
          if (!file) return;
          try {
            toast(`Uploading ${file.name}…`, 'info', 5000);
            const result = await uploads.upload(file);
            const mediaUrl = result.url || result.file_url || '';
            if (!mediaUrl) throw new Error('Upload response missing URL');
            pendingAttachments.push(mediaUrl);
            updateAttachmentBadge();
            toast(`Attached ${file.name}`, 'success');
          } catch (e) {
            toast(e?.message || 'Upload failed', 'error');
          }
          fileInput.value = '';
        });
        const attachBtn = el('button', { class: 'input-icon-btn', type: 'button', title: 'Attach file', 'aria-label': 'Attach file', onClick: () => fileInput.click() });
        const gifBtn = el('button', {
          class: 'input-pill-btn',
          type: 'button',
          title: 'Add a GIF',
          'aria-label': 'Add a GIF',
          onClick: () => showGifPicker({
            onSelect: (url) => {
              pendingAttachments.push(url);
              updateAttachmentBadge();
              toast('GIF added to your message', 'success');
            },
          }),
        }, 'GIPHY');
        const nsfwBtn = el('button', {
          class: 'input-pill-btn',
          type: 'button',
          title: 'Mark message as NSFW',
          'aria-label': 'Toggle NSFW message',
          onClick: () => {
            pendingNsfw = !pendingNsfw;
            updateAttachmentBadge();
          },
        }, 'NSFW');
        const workspaceBtn = communityToolsEnabled() ? el('button', {
          class: 'input-icon-btn',
          type: 'button',
          title: 'Open Workspace',
          'aria-label': 'Open Workspace',
          onClick: () => showCommunityHub('workspace'),
        }, heroIcon('pencilSquare', { size: 18 })) : null;

        const textarea = document.createElement('textarea');
        textarea.className = 'chat-textarea';
        const activeChannel = findChannelById(channelId);
        const channelLabel = activeChannel?.type === 'dm'
          ? (dmDisplayName(activeChannel) || 'direct-message')
          : (activeChannel?.name || 'channel');
        textarea.placeholder = activeChannel?.type === 'dm'
          ? `Message ${channelLabel}`
          : `Message #${channelLabel}`;
        textarea.rows = 1;
        textarea.maxLength = 4000;

        function emitTyping(active) {
          if (!socket || !store.state.wsConnected) return;
          if (active === typingActive) return;
          typingActive = active;
          socket.send({ action: 'typing', channel_id: idKey(channelId), active });
        }

        function scheduleTypingState() {
          const hasContent = !!textarea.value.trim();
          if (!hasContent) {
            emitTyping(false);
            if (typingTimer) {
              clearTimeout(typingTimer);
              typingTimer = null;
            }
            return;
          }
          emitTyping(true);
          if (typingTimer) clearTimeout(typingTimer);
          typingTimer = setTimeout(() => emitTyping(false), 1800);
        }

        textarea.addEventListener('input', () => {
          textarea.style.height = 'auto';
          textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
          scheduleTypingState();
        });
        textarea.addEventListener('blur', () => emitTyping(false));

        textarea.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            await send();
          }
        });

        const sendBtn = el('button', { class: 'send-btn', type: 'button', title: 'Send', 'aria-label': 'Send message', onClick: send }, heroIcon('paperAirplane', { size: 18 }));

        textarea.addEventListener('input', () => {
          updateAttachmentBadge();
        });

        toolbar.append(attachBtn, gifBtn, nsfwBtn);
        if (workspaceBtn) toolbar.appendChild(workspaceBtn);
        box.append(textarea, sendBtn);
        metaRow.append(multilineHint, charCount);
        area.append(replyBar, attachmentTray, toolbar, fileInput, box, metaRow);

        function renderReplyBar() {
          replyBar.innerHTML = '';
          if (!replyTarget) {
            replyBar.hidden = true;
            return;
          }
          const replyAuthor = replyTarget.author || userCache.get(replyTarget.author_id) || { username: 'Unknown', id: replyTarget.author_id };
          replyBar.hidden = false;
          replyBar.append(
            el('div', { class: 'composer-reply-main' },
              el('div', { class: 'composer-reply-label' }, `Replying to ${displayName(replyAuthor)}`),
              el('div', { class: 'composer-reply-snippet' }, messagePreviewText(replyTarget, 84))
            ),
            el('button', {
              class: 'composer-reply-close',
              type: 'button',
              title: 'Cancel reply',
              onClick: () => setReplyTarget(null),
            }, heroIcon('xMark', { size: 14 }))
          );
        }

        function renderAttachmentTray() {
          attachmentTray.innerHTML = '';
          if (!pendingAttachments.length) {
            attachmentTray.hidden = true;
            return;
          }

          attachmentTray.hidden = false;
          pendingAttachments.forEach((url, index) => {
            const attachment = toAttachmentObj(url);
            const isGif = isGifUrl(attachment?.url || url);
            attachmentTray.appendChild(
              el('button', {
                class: 'composer-attachment-chip',
                type: 'button',
                title: 'Remove attachment',
                onClick: () => {
                  pendingAttachments = pendingAttachments.filter((_, itemIndex) => itemIndex !== index);
                  updateAttachmentBadge();
                },
              },
                el('span', { class: 'composer-attachment-kind' }, isGif ? 'GIF' : 'File'),
                el('span', { class: 'composer-attachment-name' }, attachment?.filename || (isGif ? 'GIF' : 'Attachment')),
                heroIcon('xMark', { size: 12 })
              )
            );
          });
        }

        function updateAttachmentBadge() {
          setIconCount(attachBtn, 'paperClip', pendingAttachments.length, 18);
          attachBtn.title = pendingAttachments.length
            ? `Attached files: ${pendingAttachments.length}`
            : 'Attach file';
          gifBtn.classList.toggle('active', pendingAttachments.some((url) => isGifUrl(url)));
          nsfwBtn.classList.toggle('active', pendingNsfw);
          nsfwBtn.textContent = pendingNsfw ? 'NSFW On' : 'NSFW';
          sendBtn.classList.toggle('ready', textarea.value.trim().length > 0 || pendingAttachments.length > 0);
          charCount.textContent = `${textarea.value.length} chars`;
          multilineHint.textContent = textarea.scrollHeight > 56 ? 'Multi-line message' : 'Shift + Enter for a new line';
          renderAttachmentTray();
          renderReplyBar();
        }

        function setReplyTarget(message) {
          replyTarget = message ? { ...message } : null;
          if (replyTarget?.author_id && !replyTarget.author) {
            getUserCached(replyTarget.author_id).then((user) => {
              if (!replyTarget || !idsEqual(replyTarget.id, message?.id)) return;
              if (user) replyTarget.author = user;
              renderReplyBar();
            }).catch(() => { });
          }
          renderReplyBar();
          textarea.focus();
        }

        async function send() {
          const content = textarea.value.trim();
          if (!content && !pendingAttachments.length) return;
          const previousReplyTarget = replyTarget ? { ...replyTarget } : null;
          const attached = [...pendingAttachments];
          const flaggedNsfw = !!pendingNsfw;
          const optimisticId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const optimisticMessage = {
            id: optimisticId,
            channel_id: idKey(channelId),
            content,
            attachments: attached,
            reply_to_id: previousReplyTarget?.id || null,
            reply_to: previousReplyTarget || null,
            created_at: new Date().toISOString(),
            author_id: store.state.user?.id,
            author: store.state.user,
            is_nsfw: flaggedNsfw,
            reactions: [],
            pending: true,
          };
          textarea.value = '';
          textarea.style.height = 'auto';
          sendBtn.classList.remove('ready');
          pendingAttachments = [];
          replyTarget = null;
          pendingNsfw = false;
          emitTyping(false);
          updateAttachmentBadge();
          if (msgListEl?.addMessage) {
            msgListEl.addMessage(optimisticMessage);
          }
          try {
            const msg = await msgApi.send(channelId, content, attached, previousReplyTarget?.id || null, flaggedNsfw);
            if (msgListEl?.replaceTemporaryMessage?.(optimisticId, {
                ...msg,
                author: store.state.user,
                channel_id: idKey(channelId),
                reply_to_id: previousReplyTarget?.id || null,
                is_nsfw: Boolean(msg?.is_nsfw ?? flaggedNsfw),
              })) {
              void markChannelRead(channelId, msg.id);
              return;
            }
            if (msgListEl) {
              msgListEl.addMessage({
                ...msg,
                author: store.state.user,
                channel_id: idKey(channelId),
                reply_to_id: previousReplyTarget?.id || null,
                is_nsfw: Boolean(msg?.is_nsfw ?? flaggedNsfw),
              });
            }
            void markChannelRead(channelId, msg.id);
          } catch (e) {
            msgListEl?.deleteMessage?.(optimisticId);
            toast(e?.message || 'Failed to send', 'error');
            textarea.value = content;
            pendingAttachments = attached;
            replyTarget = previousReplyTarget;
            pendingNsfw = flaggedNsfw;
            updateAttachmentBadge();
          }
        }

        area.setReplyTarget = setReplyTarget;
        area.clearReplyTarget = () => setReplyTarget(null);
        updateAttachmentBadge();
        return area;
      }

      function renderMemberSidebar() {
        const { activeServerId, members: memsMap, sidebarMode, activeChannelId, memberSidebarOpen } = store.state;
        memberSidebar.innerHTML = '';
        memberSidebar.className = 'member-sidebar';
        memberSidebar.classList.toggle('is-drawer', true);
        memberSidebar.hidden = sidebarMode === 'community' || !memberSidebarOpen;

        if (memberSidebar.hidden) return;

        const activeChannel = getChannelFromState(activeChannelId);
        const isDmPanel = String(activeChannel?.type || '').toLowerCase() === 'dm' || sidebarMode === 'dms';
        const mems = isDmPanel
          ? (activeChannel?.participants || []).map((participant) => ({
            user_id: participant?.id,
            role: 'member',
            user: participant,
          }))
          : ((activeServerId && memsMap[activeServerId]) || []);
        const canEditRoles = canManageRoles(activeServerId);
        memberSidebar.appendChild(
          el('div', { class: 'member-drawer-head' },
            el('div', { class: 'member-drawer-title' }, isDmPanel ? 'Conversation' : 'Members'),
            el('button', {
              class: 'topbar-btn',
              type: 'button',
              title: 'Close Members Panel',
              'aria-label': 'Close Members Panel',
              onClick: () => {
                store.set({ memberSidebarOpen: false });
                renderMemberSidebar();
              },
            }, heroIcon('xMark', { size: 16 })),
          )
        );

        const groups = { 'Owner': [], 'Admin': [], 'Moderator': [], 'Member': [] };
        for (const m of mems) {
          const role = m.role
            ? m.role.charAt(0).toUpperCase() + m.role.slice(1)
            : 'Member';
          if (groups[role]) groups[role].push(m);
          else groups['Member'].push(m);
        }

        for (const [groupName, groupMems] of Object.entries(groups)) {
          if (!groupMems.length) continue;
          memberSidebar.appendChild(el('div', { class: 'member-cat' }, `${groupName} — ${groupMems.length}`));
          for (const m of groupMems) {
            const user = m.user || m;
            const label = displayName(user);
            const av = avatarEl(label, 'member-av', 32, user.avatar);
            av.style.background = avatarColor(label || '');
            const dot = el('div', { class: `status-ring s-${user.presence || 'offline'}` });
            av.appendChild(dot);

            const nameEl = el('span', {
              class: `member-name${user.presence === 'offline' ? ' muted' : ''}`
            }, label);
            const roleSelect = !isDmPanel && canEditRoles && !idsEqual(m.user_id, store.state.user?.id)
              ? el('select', { class: 'member-role-select' },
                el('option', { value: 'member' }, 'Member'),
                el('option', { value: 'moderator' }, 'Moderator'),
                el('option', { value: 'admin' }, 'Admin'),
                el('option', { value: 'owner' }, 'Owner')
              )
              : null;
            if (roleSelect) {
              roleSelect.value = String(m.role || 'member');
              roleSelect.addEventListener('change', async () => {
                const nextRole = roleSelect.value;
                try {
                  await servers.setRole(activeServerId, m.user_id, nextRole);
                  await refreshServerMembers(activeServerId);
                  if (communityHubController) void communityHubController.refresh();
                  toast('Member role updated', 'success');
                } catch (error) {
                  toast(error?.message || 'Could not update role', 'error');
                  roleSelect.value = String(m.role || 'member');
                }
              });
            }

            memberSidebar.appendChild(
              el('div', { class: 'member-row' },
                el('div', { class: 'member-row-main' }, av, nameEl),
                roleSelect
              )
            );
          }
        }

        if (!mems.length && activeServerId) {
          const empty = el('div', { style: 'padding:14px;color:var(--text-muted);font-size:12px;text-align:center;' }, 'No members found');
          memberSidebar.appendChild(empty);
        }
      }

      root.cleanup = () => {
        closeStatusMenu();
        stopVoiceStatusPolling();
        stopVoiceMeterPolling();
        for (const userId of Array.from(voiceState.peers.keys())) closeVoicePeer(userId);
        if (voiceState.localStream) {
          for (const track of voiceState.localStream.getTracks()) {
            try { track.stop(); } catch { }
          }
          voiceState.localStream = null;
        }
        socket?.disconnect();
        socketSubscriptions.clear();
        socket = null;
        msgListEl = null;
      };

      // Start it all
      init();
      return root;
    }


    const app = document.getElementById('app');
    const bootLoader = document.getElementById('boot-loader');
    let appBootstrapped = false;
    let pageResourcesLoaded = document.readyState === 'complete';
    let activeViewCleanup = null;

    function maybeHideBootLoader() {
      if (!bootLoader) return;
      if (!appBootstrapped || !pageResourcesLoaded) return;
      bootLoader.classList.add('hidden');
      setTimeout(() => bootLoader.remove(), 320);
    }

    function wireChangelogModal() {
      const overlay = document.getElementById('changelog-overlay');
      const closeBtn = document.getElementById('closeChangelogBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', hideChangelogModal);
      }
      if (overlay) {
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) hideChangelogModal();
        });
      }
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideChangelogModal();
      });
    }

    window.addEventListener('load', () => {
      pageResourcesLoaded = true;
      maybeHideBootLoader();
    });

    function isEmbeddedEdgeClient() {
      const params = new URLSearchParams(window.location.search);
      return window.parent !== window && params.get('embedded') === '1' && runtimeConfig?.client_mode === 'edge';
    }

    async function tryEmbeddedEdgeHandoff() {
      if (!isEmbeddedEdgeClient() || token.access) return false;

      const params = new URLSearchParams(window.location.search);
      const expectedParentOrigin = params.get('edgeParentOrigin') || '';

      return new Promise((resolve) => {
        let settled = false;
        const settle = (result) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', handleMessage);
          clearTimeout(timer);
          resolve(!!result);
        };

        const handleMessage = async (event) => {
          if (expectedParentOrigin && event.origin !== expectedParentOrigin) return;
          if (event.data?.type !== 'wyvern.edge.handoff' || !event.data?.grant) return;
          try {
            const data = await auth.edgeExchange(event.data.grant);
            const access = data?.tokens?.access_token || data?.access_token;
            const refresh = data?.tokens?.refresh_token || data?.refresh_token;
            if (!access) throw new Error('Edge exchange did not return an access token');
            token.set(access, refresh);
            settle(true);
          } catch (error) {
            console.error('Embedded edge handoff failed', error);
            settle(false);
          }
        };

        const timer = setTimeout(() => settle(false), 4500);
        window.addEventListener('message', handleMessage);
        window.parent.postMessage({ type: 'wyvern.edge.ready' }, expectedParentOrigin || '*');
      });
    }

    function renderToast(t) {
      const existing = document.querySelector('.toast');
      if (existing) existing.remove();
      if (!t) return;
      const toastEl = el('div', { class: `toast ${t.type || ''}` }, t.message);
      document.body.appendChild(toastEl);
    }

    function render(state) {
      // Toast
      renderToast(state.toast);

      // Mobile sidebar visibility
      const layout = document.querySelector('.app-layout');
      if (layout) {
        layout.classList.toggle('mobile-sidebar-open', !!state.mobileSidebarOpen);
        layout.classList.toggle('member-panel-open', !!state.memberSidebarOpen);
      }

      // View routing
      const currentView = app.getAttribute('data-view');
      const currentNonce = app.getAttribute('data-view-nonce');
      const targetView = state.view;
      const targetNonce = String(state.viewNonce || 0);
      if (currentView === targetView && currentNonce === targetNonce) return;

      if (typeof activeViewCleanup === 'function') {
        try { activeViewCleanup(); } catch { }
        activeViewCleanup = null;
      }

      app.setAttribute('data-view', targetView);
      app.setAttribute('data-view-nonce', targetNonce);
      app.innerHTML = '';

      if (targetView === 'auth') {
        const view = AuthView();
        activeViewCleanup = typeof view?.cleanup === 'function' ? view.cleanup : null;
        app.appendChild(view);
      } else if (targetView === 'legal') {
        const view = LegalAcceptanceView();
        activeViewCleanup = typeof view?.cleanup === 'function' ? view.cleanup : null;
        app.appendChild(view);
      } else if (targetView === 'app') {
        const view = AppView();
        activeViewCleanup = typeof view?.cleanup === 'function' ? view.cleanup : null;
        app.appendChild(view);
      } else if (targetView === 'edge-shell') {
        const view = EdgeShellView();
        activeViewCleanup = typeof view?.cleanup === 'function' ? view.cleanup : null;
        app.appendChild(view);
      }
    }

    // Subscribe to store changes
    store.subscribe(render);

    // Bootstrap: check for existing session
    async function bootstrap() {
      try {
        await loadRuntimeConfig();
        if (token.access && token.access !== 'undefined') {
          try {
            const me = await enrichUserPresence(await users.me());
            store.set({ user: me, isAuthed: true, view: resolvePostAuthView(me) });
            if (await maybeLaunchWyvFromQuery()) return;
            return;
          } catch {
            token.clear();
          }
        } else if (token.access === 'undefined') {
          token.clear();
        }
        if (await tryEmbeddedEdgeHandoff()) {
          const me = await enrichUserPresence(await users.me());
          store.set({ user: me, isAuthed: true, view: resolvePostAuthView(me) });
          if (await maybeLaunchWyvFromQuery()) return;
          return;
        }
        store.set({ view: 'auth' });
      } finally {
        appBootstrapped = true;
        maybeHideBootLoader();
        wireChangelogModal();
        if (shouldAutoOpenChangelog()) {
          showChangelogModal();
          void loadChangelog();
        }
      }
    }

    bootstrap();
