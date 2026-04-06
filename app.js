// ---- FIREBASE / CLOUD DATABASE ----
const firebaseConfig = {
  apiKey: "AIzaSyA4ZWCLf1WlWlrZDJDuSQMN_fpRGScLL1w",
  authDomain: "coopsol.firebaseapp.com",
  projectId: "coopsol",
  storageBucket: "coopsol.firebasestorage.app",
  messagingSenderId: "300639059020",
  appId: "1:300639059020:web:8e9555965206eb979c88e9",
  measurementId: "G-8PGKW6BBEP"
};
firebase.initializeApp(firebaseConfig);
const firestore = firebase.firestore();
const storage = firebase.storage();

// ---- CACHE SYSTEM ----
let allClientsCache = null;
let allUsersCache = null;

async function getClientsData(forceRefresh = false) {
    if (!allClientsCache || forceRefresh) {
        allClientsCache = await db.getClients();
    }
    return allClientsCache;
}

async function getUsersData(forceRefresh = false) {
    if (!allUsersCache || forceRefresh) {
        allUsersCache = await db.getUsers();
    }
    return allUsersCache;
}

function invalidateCaches() {
    allClientsCache = null;
    allUsersCache = null;
}

const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
};

const db = {
    getGlobalKwhPrice: async () => {
        try {
            const d = await firestore.collection('settings').doc('general').get();
            return d.exists ? d.data().kwhPrice : 0.95;
        } catch(e) { return 0.95; }
    },
    setGlobalKwhPrice: async (p) => {
        await firestore.collection('settings').doc('general').set({ kwhPrice: p }, { merge: true });
    },
    getUsers: async () => {
        const snap = await firestore.collection('users').get();
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    saveUser: async (user) => {
        await firestore.collection('users').doc(String(user.id)).set(user);
    },
    getClients: async () => {
        const snap = await firestore.collection('clients').get();
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    },
    saveClient: async (client) => {
        await firestore.collection('clients').doc(String(client.id)).set(client, { merge: true });
    },
    deleteClient: async (id) => {
        await firestore.collection('clients').doc(String(id)).delete();
    },
    deleteUser: async (id) => {
        await firestore.collection('users').doc(String(id)).delete();
    },
    deleteClientsBySeller: async (sellerId) => {
        const snap = await firestore.collection('clients').where('sellerId', '==', String(sellerId)).get();
        const batch = firestore.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    },
    reassignClientsBySeller: async (oldSellerId, newSellerId) => {
        const snap = await firestore.collection('clients').where('sellerId', '==', String(oldSellerId)).get();
        const batch = firestore.batch();
        snap.docs.forEach(doc => batch.update(doc.ref, { sellerId: String(newSellerId) }));
        await batch.commit();
    },
    uploadBillFile: async (file, clientId) => {
        if(!file) return null;
        let fileToUpload = file;
        
        if(file.type.match(/image.*/)) {
            console.log('Tamanho original da imagem:', (file.size / 1024).toFixed(2), 'KB');
            try {
                fileToUpload = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error("Timeout Compressão")), 10000);
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = new Image();
                        img.onload = () => {
                            clearTimeout(timer);
                            try {
                                const canvas = document.createElement('canvas');
                                let w = img.width; let h = img.height;
                                const max = 1200;
                                if(w > h && w > max) { h *= max/w; w = max; }
                                else if(h > max) { w *= max/h; h = max; }
                                canvas.width = w; canvas.height = h;
                                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                                canvas.toBlob(blob => {
                                    if(!blob) return reject(new Error("Blob failed"));
                                    console.log('Tamanho compr.:', (blob.size / 1024).toFixed(2), 'KB');
                                    resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                                }, 'image/jpeg', 0.75);
                            } catch(err) {
                                reject(err);
                            }
                        };
                        img.onerror = () => { clearTimeout(timer); reject(new Error("Formato não suportado para compressão (ex: HEIC)")); };
                        img.src = e.target.result;
                    };
                    reader.onerror = () => { clearTimeout(timer); reject(new Error("Falha ao ler o arquivo")); };
                    reader.readAsDataURL(file);
                });
            } catch(e) {
                console.error("Erro na compressão (Enviando original):", e);
                fileToUpload = file; // Fallback to original
            }
        }
        
        const ext = fileToUpload.type === 'image/jpeg' ? 'jpg' : fileToUpload.name.split('.').pop();
        const ref = storage.ref(`clientes/${clientId}/conta_luz_${Date.now()}.${ext}`);
        
        console.log("Upload p/ nuvem:", fileToUpload.name, "Tamanho:", (fileToUpload.size / 1024).toFixed(2), "KB");
        
        await new Promise((resolve, reject) => {
            const uploadTask = ref.put(fileToUpload);
            const timeout = setTimeout(() => {
                uploadTask.cancel();
                reject(new Error("Timeout Conexão: Servidor da Google travou o envio (CORS/Rede)"));
            }, 12000);
            
            uploadTask.then(() => {
                clearTimeout(timeout);
                resolve();
            }).catch(err => {
                clearTimeout(timeout);
                reject(err);
            });
        });
        
        return await ref.getDownloadURL();
    }
};

// ---- ADMIN ACCESS ----
const ADMIN_EMAILS = [
    'vinicius@coopsol.com',
    'luisvalgas@coopsol.com',
    'taise@coopsol.com'
];

function isUserAdmin(user) {
    if (!user || !user.email) return false;
    return ADMIN_EMAILS.includes(user.email.toLowerCase());
}

// ---- AUTH STATE ----
let currentUser = JSON.parse(localStorage.getItem('crm_current_user')) || null;
let currentFilters = { search: '', status: 'all', sellerId: 'all' };
let commissionFilters = { sellerId: 'all' };
let analyticsUnit = 'kWh'; // kWh or BRL

const auth = {
    login: async (email, password) => {
        const users = await db.getUsers();
        const user = users.find(u => u.email === email && u.password === password && u.status !== 'Negado');
        if(user) {
            currentUser = user;
            localStorage.setItem('crm_current_user', JSON.stringify(user));
            return true;
        }
        return false;
    },
    register: async (name, email, password) => {
        const users = await db.getUsers();
        if(users.find(u => u.email === email)) return false;
        const newUser = { id: Date.now().toString(), name, email, password, status: 'Ativo' };
        await db.saveUser(newUser);
        return true;
    },
    logout: () => {
        currentUser = null;
        localStorage.removeItem('crm_current_user');
        navigate('login');
    }
};

// ---- UTILS ----
const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(val);

function getContractStatusStyle(status) {
    const styles = {
        'Em preparação':       'background: rgba(100,116,139,0.1); color: #64748b; border: 1px solid rgba(100,116,139,0.3);',
        'Pronto':              'background: rgba(59,130,246,0.1); color: #3b82f6; border: 1px solid rgba(59,130,246,0.3);',
        'Aguardando assinatura': 'background: rgba(217,119,6,0.1); color: #d97706; border: 1px solid rgba(217,119,6,0.3);',
        'Assinado':            'background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.3);',
        'Recusado':            'background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);',
    };
    return styles[status] || styles['Em preparação'];
}

window.checkContractStatus = async (clientId, autentiqueDocId) => {
    const badge = document.getElementById(`contract-status-badge-${clientId}`);
    if (badge) { badge.textContent = '⏳ Consultando...'; badge.style = 'background:rgba(100,116,139,0.1);color:#64748b;border:1px solid rgba(100,116,139,0.3);padding:0.2rem 0.6rem;border-radius:6px;font-size:0.8rem;'; }

    try {
        const res = await fetch(`/api/status-contrato/${autentiqueDocId}`);
        const data = await res.json();

        if (!data.ok) {
            alert('Erro ao consultar Autentique: ' + (data.error || 'Erro desconhecido'));
            return;
        }

        const newStatus = data.status;
        const update = { id: clientId, contractStatus: newStatus };
        
        // Se assinado, atualiza status principal também
        if (newStatus === 'Assinado') {
            update.status = 'Assinado';
            update.contractSignedAt = new Date().toISOString();
        }

        await db.saveClient(update);
        invalidateCaches();

        // Atualiza badge na tela
        if (badge) {
            badge.textContent = newStatus;
            badge.setAttribute('style', getContractStatusStyle(newStatus) + 'padding:0.2rem 0.6rem;border-radius:6px;font-size:0.8rem;');
        }

        const sigInfo = data.signatures.map(s =>
            `${s.name || s.email}: ${s.signed ? '✅ Assinado' : (s.rejected ? '❌ Recusado' : (s.viewed ? '👁️ Visualizou' : '⏳ Pendente'))}`
        ).join('\n');

        alert(`Status do contrato: ${newStatus}\n\n${sigInfo}`);

    } catch(e) {
        alert('Erro de conexão ao verificar status: ' + e.message);
    }
};

window.syncAllAwaitingContracts = async () => {
    const allClients = await getClientsData();
    // Filtra clientes que estão aguardando assinatura (status principal ou status contrato)
    const pending = allClients.filter(c => c.autentiqueDocId && c.contractStatus !== 'Assinado' && c.contractStatus !== 'Recusado');
    
    if (pending.length === 0) {
        alert('Nenhum contrato aguardando assinatura com ID do Autentique encontrado.');
        return;
    }

    const btn = event.currentTarget;
    const oldText = btn.innerHTML;
    btn.innerHTML = '⏳ Sincronizando...';
    btn.disabled = true;

    let successCount = 0;
    for (const c of pending) {
        try {
            const res = await fetch(`/api/status-contrato/${c.autentiqueDocId}`);
            const data = await res.json();
            if (data.ok && data.status) {
                const newStatus = data.status;
                const update = { id: c.id, contractStatus: newStatus };
                
                if (newStatus === 'Assinado') {
                    update.status = 'Assinado';
                    update.contractSignedAt = new Date().toISOString();
                } else if (newStatus === 'Aguardando assinatura') {
                    update.status = 'Aguardando assinatura';
                }

                await db.saveClient(update);
                successCount++;
            }
        } catch (e) {
            console.error(`Erro ao sincronizar cliente ${c.id}:`, e);
        }
    }

    invalidateCaches();
    btn.innerHTML = oldText;
    btn.disabled = false;
    alert(`Sincronização concluída! ${successCount} cliente(s) processado(s).`);
    navigate('clients');
};

// ---- THEME ----
(function initTheme() {
    const saved = localStorage.getItem('crm_theme') || 'light';
    document.body.setAttribute('data-theme', saved);
})();

window.toggleTheme = () => {
    const current = document.body.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('crm_theme', next);
    // Sync all checkboxes on page
    document.querySelectorAll('.theme-switch input').forEach(cb => { cb.checked = next === 'dark'; });
};

// ---- ROUTER ----
async function navigate(route, data = null) {
    const app = document.getElementById('app');
    
    if(route === 'login') app.innerHTML = ViewLogin();
    else if(route === 'register') app.innerHTML = ViewRegister();
    else if(route === 'dashboard') {
        if(!currentUser) return navigate('login');
        app.innerHTML = '<div style="text-align:center; padding: 3rem; font-size: 1.2rem; color: var(--text-main);">Carregando Painel...</div>';
        app.innerHTML = await ViewDashboard();
    }
    else if(route === 'clients') {
        if(!currentUser) return navigate('login');
        
        // Verifica se já estamos na página de clientes para não reconstruir o 'esqueleto'
        const inputSearch = document.getElementById('filter-search');
        if(!inputSearch) {
            // Primeiro load da página: mostra carregando e constrói o esqueleto
            app.innerHTML = '<div style="text-align:center; padding: 3rem; font-size: 1.2rem; color: var(--text-main);">Carregando Clientes...</div>';
            app.innerHTML = await ViewClients();
        } else {
            // Já estamos na página: apenas atualiza a tabela silenciosamente
            updateDashboardFilters(inputSearch.value, document.getElementById('filter-status').value, document.getElementById('filter-seller') ? document.getElementById('filter-seller').value : 'all');
        }
    }
    else if(route === 'settings') {
        if(!currentUser) return navigate('login');
        app.innerHTML = await ViewSettings();
    }
    else if(route === 'simulation') {
        if(!currentUser) return navigate('login');
        app.innerHTML = await ViewSimulation(data);
    }
    else if(route === 'quickSim') {
        if(!currentUser) return navigate('login');
        app.innerHTML = ViewQuickSim();
    }
    else if(route === 'commissions') {
        if(!currentUser) return navigate('login');
        app.innerHTML = '<div style="text-align:center; padding: 3rem; font-size: 1.2rem; color: var(--text-main);">Calculando comissões na Nuvem...</div>';
        app.innerHTML = await ViewCommissions();
    }
    else if(route === 'gallery') {
        if(!currentUser) return navigate('login');
        return navigate('dashboard'); // Gallery removed
    }
    else if(route === 'clientView') {
        if(!currentUser) return navigate('login');
        app.innerHTML = await ViewClientDetailsOnly(data);
    }
    else if(route === 'analytics') {
        if(!currentUser) return navigate('login');
        app.innerHTML = '<div style="text-align:center; padding: 3rem; font-size: 1.2rem; color: var(--text-main);">Gerando Relatórios e Gráficos...</div>';
        app.innerHTML = await ViewAnalytics();
    }
}

// ---- VIEWS ----
const CoopsolLogo = () => `
<svg viewBox="0 0 300 115" style="max-width: 100%; height: auto;" xmlns="http://www.w3.org/2000/svg">
  <path d="M 50 50 A 45 45 0 0 1 140 50 Z" fill="#d97706" />
  <path d="M 10 45 C 70 70, 140 20, 280 50 C 290 52, 290 60, 280 60 C 140 30, 70 80, 10 55 Z" fill="#009e2f" />
  <text x="25" y="95" font-family="'Inter', -apple-system, sans-serif" font-weight="800" font-size="46" fill="#1e293b">Coopsol</text>
  <text x="32" y="110" font-family="'Inter', -apple-system, sans-serif" font-weight="500" font-size="12" fill="#64748b" letter-spacing="1">A Cooperativa do Sol</text>
</svg>`;

const ViewLogin = () => `
<div class="auth-layout">
    <div class="auth-card glass">
        <div style="margin-bottom: 1.5rem; text-align: center; max-width: 220px; margin-left: auto; margin-right: auto;">
            ${CoopsolLogo()}
        </div>
        <p>Login do Vendedor</p>
        <form onsubmit="handleLogin(event)">
            <div class="input-group">
                <label>E-mail</label>
                <input type="email" id="email" required placeholder="vendedor@email.com">
            </div>
            <div class="input-group">
                <label>Senha</label>
                <input type="password" id="password" required placeholder="••••••••">
            </div>
            <button type="submit" class="btn btn-primary">Entrar no Painel</button>
        </form>
        <span class="link" onclick="navigate('register')">Não tem uma conta? Cadastre-se</span>
    </div>
</div>`;

const ViewRegister = () => `
<div class="auth-layout">
    <div class="auth-card glass">
        <div style="margin-bottom: 1.5rem; text-align: center; max-width: 220px; margin-left: auto; margin-right: auto;">
            ${CoopsolLogo()}
        </div>
        <p>Criar Conta de Vendedor</p>
        <form onsubmit="handleRegister(event)">
            <div class="input-group">
                <label>Nome Completo</label>
                <input type="text" id="reg-name" required placeholder="João da Silva">
            </div>
            <div class="input-group">
                <label>E-mail</label>
                <input type="email" id="reg-email" required placeholder="vendedor@email.com">
            </div>
            <div class="input-group">
                <label>Senha</label>
                <input type="password" id="reg-password" required placeholder="••••••••">
            </div>
            <button type="submit" class="btn btn-primary">Cadastrar</button>
        </form>
        <span class="link" onclick="navigate('login')">Já tenho conta</span>
    </div>
</div>`;

const Sidebar = (active) => {
    const isAdmin = isUserAdmin(currentUser);
    return `
<div class="sidebar" id="app-sidebar">
    <div class="sidebar-header" style="display: flex; justify-content: space-between; align-items: center;">
        <div class="brand" style="max-width: 150px; margin-bottom: 0;">
            ${CoopsolLogo()}
        </div>
        <button class="mobile-menu-btn" onclick="document.getElementById('app-sidebar').classList.toggle('open')">☰</button>
    </div>
    <div class="nav-links">
        <div class="nav-item ${active === 'dashboard' ? 'active' : ''}" onclick="navigate('dashboard')">Painel Inicial</div>
        <div class="nav-item ${active === 'clients' ? 'active' : ''}" onclick="navigate('clients')">Clientes</div>
        <div class="nav-item ${active === 'quickSim' ? 'active' : ''}" onclick="navigate('quickSim')">Simulação Rápida</div>
        <div class="nav-item ${active === 'simulation' ? 'active' : ''}" onclick="navigate('simulation')">Fechar Cliente</div>
        ${isAdmin ? `<div class="nav-item ${active === 'commissions' ? 'active' : ''}" onclick="navigate('commissions')">Comissões</div>` : ''}
        ${isAdmin ? `<div class="nav-item ${active === 'analytics' ? 'active' : ''}" onclick="navigate('analytics')" style="margin-top: 1.5rem; color: #b48500; font-weight: bold;">📊 Análises</div>` : ''}
        ${isAdmin ? `<div class="nav-item ${active === 'settings' ? 'active' : ''}" onclick="navigate('settings')" style="color: #b48500; font-weight: bold;">⚙️ Preço Base kWh</div>` : ''}
        
        <div class="user-info">
            <p style="color: var(--text-main);">${currentUser.name}</p>
            <button onclick="auth.logout()">Sair da conta</button>
            <label class="theme-switch-wrap" title="Alternar tema">
                <span>🌙</span>
                <span class="theme-switch">
                    <input type="checkbox" ${(document.body.getAttribute('data-theme')||'light') === 'dark' ? 'checked' : ''} onchange="toggleTheme()">
                    <span class="theme-slider"></span>
                </span>
                <span>☀️</span>
            </label>
        </div>
    </div>
</div>`;
};

const ViewDashboard = async () => {
    const isAdmin = isUserAdmin(currentUser);
    const allClients = await db.getClients();
    const users = isAdmin ? await db.getUsers() : [];
    
    const clients = isAdmin ? allClients : allClients.filter(c => c.sellerId === currentUser.id);
    const activeClients = clients.filter(c => c.status !== 'Perdida' && c.status !== 'Desativado');
    const total = activeClients.length;
    const converted = clients.filter(c => c.status === 'Fechado' || c.status === 'Convertido').length;

    let adminUsersTable = '';
    if(isAdmin) {
        const userRows = users.map(u => {
            const isAdminAcc = isUserAdmin(u);
            const isActive = (u.status || 'Ativo') !== 'Negado';
            const hasRec = u.hasRecurrence !== false;

            let recurrenceBtn = '';
            if (!isAdminAcc) {
                recurrenceBtn = `<button id="btn-rec-${u.id}" onclick="toggleSellerRecurrence('${u.id}', ${!hasRec})" style="
                    padding: 0.3rem 0.8rem; font-size: 0.75rem; border-radius: 20px; cursor: pointer;
                    font-weight: 600; border: 2px solid ${hasRec ? '#10b981' : '#64748b'};
                    background: ${hasRec ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.10)'};
                    color: ${hasRec ? '#10b981' : '#94a3b8'};
                ">${hasRec ? '✅ Com Recorrência' : '❌ Sem Recorrência'}</button>`;
            } else {
                recurrenceBtn = `<span style="font-size:0.75rem; color:var(--text-muted);">—</span>`;
            }

            let actionBtn = '';
            if (!isAdminAcc) {
                actionBtn = `<div style="display:flex; gap:0.5rem;">
                    ${isActive
                        ? `<button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.75rem;color:var(--danger);border-color:rgba(239,68,68,0.3);" onclick="toggleUserStatus('${u.id}','Negado')">Bloquear</button>`
                        : `<button class="btn btn-primary" style="padding:0.3rem 0.6rem;font-size:0.75rem;" onclick="toggleUserStatus('${u.id}','Ativo')">Ativar</button>`}
                    <button class="btn btn-outline" style="padding:0.3rem 0.6rem;font-size:0.75rem;color:var(--danger);border-color:rgba(239,68,68,0.3);" onclick="handleDeleteUser('${u.id}','${u.name}')">Excluir</button>
                </div>`;
            } else {
                actionBtn = `<span style="font-size:0.8rem;color:var(--text-muted);">Admin</span>`;
            }

            return `
            <tr>
                <td><strong>${u.name}</strong></td>
                <td>${u.email}</td>
                <td><span class="status-badge ${!isActive ? 'status-perdida' : 'status-fechado'}">${u.status || 'Ativo'}</span></td>
                <td>${recurrenceBtn}</td>
                <td>${actionBtn}</td>
            </tr>`;
        }).join('');
        
        adminUsersTable = `
            <div class="table-container glass" style="margin-top: 2rem;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
                    <h3 style="margin:0;">Vendedores Registrados</h3>
                    <small style="color:var(--text-muted); font-size:0.8rem;">Recorrência = 5% mensal por cliente &middot; Sem recorrência = empresa fica com 10% de taxa admin</small>
                </div>
                <table class="client-list">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>E-mail</th>
                            <th>Status de Acesso</th>
                            <th>Recorrência</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>${userRows || '<tr><td colspan="5" style="text-align:center;">Nenhum usuário</td></tr>'}</tbody>
                </table>
            </div>
        `;
    }

    return `
    <div class="app-layout">
        ${Sidebar('dashboard')}
        <div class="main-content">
            <div class="header">
                <h2>Olá, ${currentUser.name}</h2>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card glass">
                    <span class="label">Clientes Ativos</span>
                    <span class="value">${total}</span>
                </div>
                <div class="stat-card glass conversions">
                    <span class="label">Contratos Fechados</span>
                    <span class="value">${converted}</span>
                </div>
            </div>

            ${adminUsersTable}
        </div>
    </div>`;
};

const ViewSettings = async () => {
    const isAdmin = isUserAdmin(currentUser);
    if(!isAdmin) return navigate('dashboard');

    let globalPrice = 0.95;
    try { globalPrice = await db.getGlobalKwhPrice(); } catch(e) {}

    return `
    <div class="app-layout">
        ${Sidebar('settings')}
        <div class="main-content">
            <div class="header">
                <h2>Configurações Globais</h2>
            </div>
            
            <div class="table-container glass" style="max-width: 600px;">
                <h3>Preço Base do kWh</h3>
                <p style="color: var(--text-muted); margin-bottom: 1.5rem;">Este valor é utilizado como base para todas as simulações e cálculos de economia.</p>
                <div style="display: flex; gap: 1rem; align-items: flex-end;">
                    <div class="input-group" style="flex: 1;">
                        <label>Valor do kWh (R$)</label>
                        <input type="number" id="admin-global-kwh" step="0.001" min="0.01" value="${globalPrice}">
                    </div>
                    <button class="btn btn-success" onclick="updateGlobalKwhPrice()">Salvar Configuração</button>
                </div>
            </div>
        </div>
    </div>`;
};

const renderClientRows = (filtered, isAdmin, users) => {
    return filtered.map(c => {
        const clsStatus = c.status.toLowerCase().replace(/\s+/g, '-').replace('ç','c').replace('ã','a');
        const sellerName = isAdmin ? `<br><small style="color:var(--text-muted)">Vendedor(a): ${users.find(u => String(u.id) === String(c.sellerId))?.name || 'Desconhecido'}</small>` : '';
        const tempOptions = ['Quente', 'Morno', 'Frio', 'Fechado'];
        const tempEmojiMap = { 'Quente': '🔥', 'Morno': '🌤️', 'Frio': '❄️', 'Fechado': '🤝' };
        const tempColorMap = { 'Quente': '#ef4444', 'Morno': '#f59e0b', 'Frio': '#3b82f6', 'Fechado': '#10b981' };
        
        const currentTemp = c.temperature || 'Morno';
        const tempColor = tempColorMap[currentTemp];

        return `
        <tr style="cursor: pointer;" onclick="if(event.target.tagName !== 'BUTTON' && event.target.tagName !== 'SELECT') viewClientDetails('${c.id}')">
            <td>
                <strong>${c.name}</strong>${sellerName}
                <br>
                <select onchange="updateClientTemperature('${c.id}', this.value)" style="background: transparent; border: 1px solid ${tempColor}; color: ${tempColor}; font-size: 0.7rem; font-weight: bold; border-radius: 4px; padding: 0.1rem 0.3rem; margin-top: 0.3rem; outline: none; cursor: pointer;">
                    ${tempOptions.map(t => `<option value="${t}" ${currentTemp === t ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">${tempEmojiMap[t]} ${t}</option>`).join('')}
                </select>
            </td>
            <td>${formatCurrency(c.billValue)}</td>
            <td><span class="status-badge status-${clsStatus}">${c.status}</span></td>
            <td>
                <select onchange="updateContractStatus('${c.id}', this.value)" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-main); font-size: 0.75rem; border-radius: 4px; padding: 0.2rem; cursor: pointer; outline: none;">
                    <option value="Em preparação" ${c.contractStatus === 'Em preparação' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Em preparação</option>
                    <option value="Pronto" ${c.contractStatus === 'Pronto' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Pronto</option>
                    <option value="Aguardando assinatura" ${c.contractStatus === 'Aguardando assinatura' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Aguardando ass.</option>
                    <option value="Assinado" ${c.contractStatus === 'Assinado' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Assinado</option>
                </select>
            </td>
            <td>${c.discountPercent}%</td>
            <td>${c.savings > 0 ? formatCurrency(c.savings) + '/mês' : '-'}</td>
            <td>
                ${(c.status !== 'Perdida' && c.status !== 'Desativado') ? 
                  `<button class="btn btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; margin-right: 0.5rem;" onclick="deactivateClient('${c.id}')">Perdida</button>` : 
                  `<button class="btn btn-primary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; margin-right: 0.5rem;" onclick="reactivateClient('${c.id}')">Reativar</button>`
                }
                ${(c.status === 'Perdida' || c.status === 'Desativado') ? 
                  `<button class="btn btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);" onclick="deleteClient('${c.id}')">Excluir</button>` : ''
                }
            </td>
        </tr>`;
    }).join('');
};

const ViewClients = async () => {
    const isAdmin = isUserAdmin(currentUser);
    const allClients = await getClientsData();
    const users = isAdmin ? await getUsersData() : [];

    // Filtros atuais
    const { search, status, sellerId } = currentFilters;

    let filtered = allClients;
    if(!isAdmin) {
        filtered = filtered.filter(c => c.sellerId === currentUser.id);
    } else if(sellerId !== 'all') {
        filtered = filtered.filter(c => String(c.sellerId) === String(sellerId));
    }

    if(status !== 'all') {
        filtered = filtered.filter(c => c.status === status);
    }

    if(search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(c => 
            c.name.toLowerCase().includes(s) || 
            (c.documentId && c.documentId.includes(s))
        );
    }

    const tableRowsHtml = renderClientRows(filtered, isAdmin, users);
    const sellerOptions = users.map(u => `<option value="${u.id}" ${sellerId === String(u.id) ? 'selected' : ''}>${u.name}</option>`).join('');

    return `
    <div class="app-layout">
        ${Sidebar('clients')}
        <div class="main-content">
            <div class="header">
                <h2>Gestão de Clientes</h2>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-outline" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;" onclick="syncAllAwaitingContracts(event)">🔄 Sincronizar Autentique</button>
                    <button class="btn btn-primary" onclick="navigate('simulation')">+ Novo Contrato</button>
                </div>
            </div>

            <div class="table-container glass" style="margin-bottom: 2rem; padding: 1.5rem;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; align-items: flex-end;">
                    <div class="input-group">
                        <label>🔍 Buscar Cliente</label>
                        <input type="text" id="filter-search" value="${search}" placeholder="Nome ou Documento..." oninput="updateDashboardFilters(this.value, document.getElementById('filter-status').value, ${isAdmin ? "document.getElementById('filter-seller').value" : "'all'"})">
                    </div>
                    <div class="input-group">
                        <label>📊 Status</label>
                        <select id="filter-status" onchange="updateDashboardFilters(document.getElementById('filter-search').value, this.value, ${isAdmin ? "document.getElementById('filter-seller').value" : "'all'"})" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-main); font-size: 0.85rem; border-radius: 6px; padding: 0.4rem;">
                            <option value="all" ${status === 'all' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Todos os Status</option>
                            <option value="Em Negociação" ${status === 'Em Negociação' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Em Negociação</option>
                            <option value="Aguardando assinatura" ${status === 'Aguardando assinatura' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Aguardando Assinatura</option>
                            <option value="Assinado" ${status === 'Assinado' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Assinado</option>
                            <option value="Fechado" ${status === 'Fechado' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Fechado</option>
                            <option value="Perdida" ${status === 'Perdida' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Perdida</option>
                        </select>
                    </div>
                    ${isAdmin ? `
                    <div class="input-group">
                        <label>👤 Vendedor</label>
                        <select id="filter-seller" onchange="updateDashboardFilters(document.getElementById('filter-search').value, document.getElementById('filter-status').value, this.value)" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-main); font-size: 0.85rem; border-radius: 6px; padding: 0.4rem;">
                            <option value="all" ${sellerId === 'all' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Todos os Vendedores</option>
                            ${sellerOptions}
                        </select>
                    </div>` : ''}
                </div>
            </div>

            <div class="table-container glass">
                <table class="client-list">
                    <thead>
                        <tr>
                            <th>Cliente</th>
                            <th>Conta Base</th>
                            <th>Status Cliente</th>
                            <th>Status Contrato</th>
                            <th>Desconto</th>
                            <th>Economia Est.</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody id="clients-table-body">${tableRowsHtml || '<tr><td colspan="7" style="text-align:center; padding: 2rem;">Nenhum cliente encontrado com os filtros aplicados.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    </div>`;
};

// ViewGallery removed

const ViewCommissions = async () => {
    const isAdmin = isUserAdmin(currentUser);
    const allClients = await db.getClients();
    const users = await db.getUsers();

    const { sellerId } = commissionFilters;
    let filtered = allClients.filter(c => c.status === 'Fechado' || c.status === 'Convertido');
    
    if(!isAdmin) {
        filtered = filtered.filter(c => c.sellerId === currentUser.id);
    } else if(sellerId !== 'all') {
        filtered = filtered.filter(c => String(c.sellerId) === String(sellerId));
    }

    const totalKwh = filtered.reduce((acc, c) => acc + (parseFloat(c.kwh) || 0), 0);
    
    let totalFirstInvoice = 0;
    let totalMonthlyRecurrent = 0;
    
    const tableRows = filtered.map(c => {
        const bill = parseFloat(c.billValue) || 0;
        let firstPercent = 0.30;
        if(bill > 6000) firstPercent = 0.60;
        else if(bill > 3000) firstPercent = 0.50;
        else if(bill > 1000) firstPercent = 0.40;
        
        const firstInvComm = bill * firstPercent;
        const monthlyComm = bill * 0.05;
        
        totalFirstInvoice += firstInvComm;
        totalMonthlyRecurrent += monthlyComm;
        
        const sellerName = isAdmin ? `<br><small style="color:var(--text-muted)">Venda de: ${users.find(u => String(u.id) === String(c.sellerId))?.name || 'Desconhecido'}</small>` : '';

        return `
        <tr>
            <td><strong>${c.name}</strong>${sellerName}</td>
            <td>${formatCurrency(bill)}</td>
            <td style="color: var(--accent-yellow); font-weight: bold; background: rgba(217, 119, 6, 0.05);">${formatCurrency(firstInvComm)} <br><small>(${firstPercent * 100}%)</small></td>
            <td style="color: var(--accent-green); font-weight: bold; background: rgba(16, 185, 129, 0.05);">${formatCurrency(monthlyComm)} <br><small>(5%)</small></td>
        </tr>`;
    }).join('');

    const bonusPercent = totalKwh > 60000 ? 0.30 : (totalKwh > 30000 ? 0.20 : (totalKwh > 10000 ? 0.10 : 0));
    const finalCommission = (totalFirstInvoice + totalMonthlyRecurrent) * (1 + bonusPercent);

    return `
    <div class="app-layout">
        ${Sidebar('commissions')}
        <div class="main-content">
            <div class="header">
                <h2>Extrato de Comissões</h2>
                ${isAdmin ? `
                <div class="input-group" style="margin: 0;">
                    <select onchange="updateCommissionFilter(this.value)" style="background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); padding: 0.5rem; border-radius: 8px; color: var(--text-main); outline: none;">
                        <option value="all" style="background: var(--bg-dark); color: var(--text-main);">Todos os Vendedores</option>
                        ${users.map(u => `<option value="${u.id}" ${sellerId === String(u.id) ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">${u.name}</option>`).join('')}
                    </select>
                </div>` : ''}
            </div>
            
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));">
                <div class="stat-card glass">
                    <span class="label">Total Vendido (Mês)</span>
                    <span class="value" style="font-size: 1.8rem;">${totalKwh.toLocaleString('pt-BR')} <small style="font-size: 0.8rem;">kWh</small></span>
                </div>
                <div class="stat-card glass">
                    <span class="label">Comissão Implantação</span>
                    <span class="value" style="color: var(--accent-yellow); font-size: 1.8rem;">${formatCurrency(totalFirstInvoice)}</span>
                </div>
                <div class="stat-card glass">
                    <span class="label">Recorrência Mensal</span>
                    <span class="value" style="color: var(--accent-green); font-size: 1.8rem;">${formatCurrency(totalMonthlyRecurrent)}</span>
                </div>
                <div class="stat-card glass conversions">
                    <span class="label">Total Estimado Mês 1</span>
                    <span class="value" style="font-size: 1.8rem; font-weight: 800;">${formatCurrency(finalCommission)}</span>
                </div>
            </div>

            <div class="table-container glass" style="margin-top: 2rem;">
                <table class="client-list">
                    <thead>
                        <tr>
                            <th>Cliente / Origem</th>
                            <th>Fatura Base</th>
                            <th>Comissão de Fechamento (Única)</th>
                            <th>Recorrência Mensal (5%)</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows || '<tr><td colspan="4" style="text-align:center; padding: 2rem;">Nenhuma venda confirmada.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    </div>`;
};

const ViewSimulation = async (client = null) => {
    const isAdmin = isUserAdmin(currentUser);
    let users = isAdmin ? await db.getUsers() : [];
    users.sort((a,b) => (a.name || '').localeCompare(b.name || ''));

    const cName = client && client.name ? client.name : '';
    const cDoc = client && client.documentId ? client.documentId : '';
    const cAddr = client && client.address ? client.address : '';
    const cKwh = client && client.kwh ? client.kwh : '';
    const cSupply = client && client.supplyClass ? client.supplyClass : 'Monofásico';
    const cKwhPrice = client && client.kwhPrice ? client.kwhPrice : '';
    const cPublicLight = client && client.publicLight !== undefined ? client.publicLight : '';
    const cRep = client && client.repClass ? client.repClass : 'Pessoa Física';
    const cUc = client && client.ucNumber ? client.ucNumber : '';
    const cContract = client && client.contractStatus ? client.contractStatus : 'Em preparação';
    const cTemp = client && client.temperature ? client.temperature : 'Morna';
    const cSellerId = client && client.sellerId ? String(client.sellerId) : String(currentUser.id);
    const cEmail = client && client.email ? client.email : '';

    return `
<div class="app-layout">
    ${Sidebar('simulation')}
    <div class="main-content">
        <div class="sim-container glass">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <h2>${client ? 'Revisar e Reativar Cliente' : 'Fechar Cliente'}</h2>
                <div style="display: flex; gap: 0.5rem; background: rgba(0,0,0,0.2); padding: 0.4rem; border-radius: 8px;">
                    <label style="font-size: 0.8rem; margin-right: 0.5rem; align-self: center;">🔥 Lead:</label>
                    <select id="sim-temperature" style="padding: 0.3rem; border-radius: 4px; background: transparent; color: white; border: 1px solid rgba(255,255,255,0.2);">
                        <option value="Quente" ${cTemp === 'Quente' ? 'selected' : ''}>Quente 🔥</option>
                        <option value="Morno" ${cTemp === 'Morno' ? 'selected' : ''}>Morno 🌤️</option>
                        <option value="Frio" ${cTemp === 'Frio' ? 'selected' : ''}>Frio ❄️</option>
                        <option value="Fechado" ${cTemp === 'Fechado' ? 'selected' : ''}>Fechado 🤝</option>
                    </select>
                </div>
            </div>

            ${isAdmin ? `
            <!-- Painel Admin - Cadastro -->
            <div style="background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; display: flex; flex-direction: column; align-items: center; text-align: center;">
                <strong style="color: #a78bfa; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem;">⚙️ Gestão Administrativa</strong>
                <div style="width: 100%; max-width: 400px;">
                    <label style="display: block; color: var(--text-muted); font-size: 0.8rem; margin-bottom: 0.5rem;">Vendedor Responsável</label>
                    <select id="sim-seller-id" style="width: 100%; padding: 0.8rem; border-radius: 8px; background: rgba(0,0,0,0.3); color: white; border: 1px solid rgba(255,255,255,0.1); outline: none; font-size: 1rem;">
                        ${users.map(u => `<option value="${u.id}" ${cSellerId === String(u.id) ? 'selected' : ''} style="background: var(--bg-dark);">${u.name}${u.email ? ' ('+u.email+')' : ''}</option>`).join('')}
                    </select>
                </div>
            </div>
            ` : ''}
            <form id="sim-form" onsubmit="handleSimulation(event, ${client ? client.id : 'null'})">
                <input type="hidden" id="sim-edit-discount" value="${client && client.discountPercent !== undefined ? client.discountPercent : ''}">
                <div style="display: flex; gap: 1rem; width: 100%;">
                    <div class="input-group" style="flex: 2;">
                        <label>Titular da Unidade Consumidora</label>
                        <input type="text" id="sim-name" value="${cName}" required placeholder="Nome completo ou Razão Social">
                    </div>
                    <div class="input-group" style="flex: 1;">
                        <label>CPF / CNPJ</label>
                        <input type="text" id="sim-document" value="${cDoc}" required placeholder="Apenas números">
                    </div>
                </div>
                <div class="input-group">
                    <label>E-mail do Cliente (Para assinatura digital)</label>
                    <input type="email" id="sim-email" value="${cEmail}" required placeholder="cliente@email.com">
                </div>
                <div class="input-group">
                    <label>Endereço</label>
                    <input type="text" id="sim-address" value="${cAddr}" required placeholder="Rua, Número, Bairro, Cidade - UF">
                </div>
                <div style="display: flex; gap: 1rem; width: 100%;">
                    <div class="input-group" style="flex: 1;">
                        <label>Nº Unidade Consumidora / Instalação</label>
                        <input type="text" id="sim-uc" value="${cUc}" required placeholder="Nº da UC ou Instalação">
                    </div>
                    <div class="input-group" style="flex: 1;">
                        <label>Status do Contrato</label>
                        <select id="sim-contract-status" required style="background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); padding: 0.8rem 1rem; border-radius: 8px; color: var(--text-main); font-size: 1rem; outline: none; width: 100%;">
                            <option value="Em preparação" ${cContract === 'Em preparação'?'selected':''}>Em preparação</option>
                            <option value="Pronto" ${cContract === 'Pronto'?'selected':''}>Pronto</option>
                            <option value="Aguardando assinatura" ${cContract === 'Aguardando assinatura'?'selected':''}>Aguardando assinatura</option>
                            <option value="Assinado" ${cContract === 'Assinado'?'selected':''}>Assinado</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; gap: 1rem; width: 100%;">
                    <div class="input-group" style="flex: 1;">
                        <label>Média Consumo (12 m) - kWh</label>
                        <input type="number" id="sim-kwh" value="${cKwh}" step="1" min="1" required placeholder="Ex: 300">
                    </div>
                    <div class="input-group" style="flex: 1;">
                        <label>Classe de fornecimento</label>
                        <select id="sim-supply-class" required style="background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); padding: 0.8rem 1rem; border-radius: 8px; color: var(--text-main); font-size: 1rem; outline: none; width: 100%;">
                            <option value="Monofásico" ${cSupply === 'Monofásico'?'selected':''}>Monofásico</option>
                            <option value="Bifásico" ${cSupply === 'Bifásico'?'selected':''}>Bifásico</option>
                            <option value="Trifásico" ${cSupply === 'Trifásico'?'selected':''}>Trifásico</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; gap: 1rem; width: 100%;">
                    <div class="input-group" style="flex: 1;">
                        <label>Taxa de Iluminação (R$)</label>
                        <input type="number" id="sim-public-light" value="${cPublicLight}" step="0.01" min="0" required placeholder="Ex: 25.50">
                    </div>
                </div>
                <div class="input-group" style="margin-top: 1rem;">
                    <label>📄 Foto da Conta de Luz (Obrigatório)</label>
                    <input type="file" id="sim-bill-file" accept="image/*,application/pdf" style="background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); padding: 0.8rem 1rem; border-radius: 8px; color: var(--text-main); width: 100%;">
                    <small style="color: var(--text-muted); font-size: 0.8rem; margin-top: 0.4rem; display: block;">Tire uma foto na hora (Celular) ou envie um arquivo em PDF/Imagem.</small>
                    ${client && client.billUrl ? `<a href="${client.billUrl}" target="_blank" style="color: var(--accent-yellow); font-size: 0.85rem; display: block; margin-top: 0.5rem; text-decoration: underline;">👁️ Ver Conta de Luz Salva</a>` : ''}
                </div>
                <div class="input-group">
                    <label>Classe do representante</label>
                    <select id="sim-rep-class" onchange="document.getElementById('pj-only-fields').style.display = this.value === 'Pessoa Jurídica' ? 'block' : 'none'" required style="background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); padding: 0.8rem 1rem; border-radius: 8px; color: var(--text-main); font-size: 1rem; outline: none; width: 100%;">
                        <option value="Pessoa Física" ${cRep === 'Pessoa Física'?'selected':''}>Pessoa Física</option>
                        <option value="Pessoa Jurídica" ${cRep === 'Pessoa Jurídica'?'selected':''}>Pessoa Jurídica</option>
                    </select>
                </div>
                
                <div style="margin-top: 1.5rem; margin-bottom: 1rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1.5rem;">
                    
                    <div style="display: flex; gap: 1rem; width: 100%;">
                        <div class="input-group" style="flex: 1;">
                            <label>Nacionalidade</label>
                            <input type="text" id="sim-rep-nacionality" value="${client && client.repNacionality ? client.repNacionality : ''}" placeholder="Ex: Brasileiro(a)">
                        </div>
                    </div>
                    <div style="display: flex; gap: 1rem; width: 100%;">
                        <div class="input-group" style="flex: 1;">
                            <label>Estado Civil</label>
                            <input type="text" id="sim-rep-civil" value="${client && client.repCivil ? client.repCivil : ''}" placeholder="Ex: Casado(a)">
                        </div>
                        <div class="input-group" style="flex: 1;">
                            <label>Profissão</label>
                            <input type="text" id="sim-rep-job" value="${client && client.repJob ? client.repJob : ''}" placeholder="Ex: Empresário">
                        </div>
                    </div>

                    <div id="pj-only-fields" style="display: ${cRep === 'Pessoa Jurídica' ? 'block' : 'none'}; width: 100%;">
                        <div style="display: flex; gap: 1rem; width: 100%;">
                            <div class="input-group" style="flex: 2;">
                                <label>Nome do Representante Legal</label>
                                <input type="text" id="sim-rep-name" value="${client && client.repName ? client.repName : ''}" placeholder="Nome completo">
                            </div>
                            <div class="input-group" style="flex: 1;">
                                <label>CPF do Rep.</label>
                                <input type="text" id="sim-rep-cpf" value="${client && client.repCpf ? client.repCpf : ''}" placeholder="Apenas números">
                            </div>
                        </div>
                        <div class="input-group">
                            <label>Endereço do Representante</label>
                            <input type="text" id="sim-rep-address" value="${client && client.repAddress ? client.repAddress : ''}" placeholder="Rua, Número, Bairro, Cidade - UF">
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 1rem; margin-top: 1rem;">
                    <button type="submit" class="btn btn-primary" style="flex: 2;">Calcular Viabilidade</button>
                    ${client ? `<button type="button" class="btn btn-outline" style="flex: 1;" onclick="saveClientMetadataOnly('${client.id}')">Salvar Apenas Dados</button>` : ''}
                </div>
            </form>

            <div id="result-box" class="result-card"></div>
        </div>
    </div>
</div>`;
};

window.ViewQuickSim = () => {
    return `
<div class="app-layout">
    ${Sidebar('quickSim')}
    <div class="main-content">
        <div class="dashboard-content" style="max-width: 800px; margin: 0 auto; padding-top: 2rem;">
            <h2>Simulação Rápida</h2>
            <p style="color: var(--text-muted); margin-bottom: 2rem;">Calcule rapidamente a economia para um prospect sem a necessidade de coletar dados pessoais ou preenchimento de contrato.</p>
            
            <form id="quick-sim-form" onsubmit="handleQuickSim(event)">
                <div style="display: flex; gap: 1rem; width: 100%;">
                    <div class="input-group" style="flex: 1;">
                        <label>Média Consumo (12 m) - kWh</label>
                        <input type="number" id="qsim-kwh" step="1" min="1" required placeholder="Ex: 300">
                    </div>
                    <div class="input-group" style="flex: 1;">
                        <label>Classe de fornecimento</label>
                        <select id="qsim-supply" required style="background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); padding: 0.8rem 1rem; border-radius: 8px; color: var(--text-main); font-size: 1rem; outline: none; width: 100%;">
                            <option value="Monofásico">Monofásico</option>
                            <option value="Bifásico">Bifásico</option>
                            <option value="Trifásico">Trifásico</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; gap: 1rem; width: 100%;">
                    <div class="input-group" style="flex: 1;">
                        <label>Taxa de Iluminação (R$)</label>
                        <input type="number" id="qsim-light" step="0.01" min="0" required placeholder="Ex: 25.50">
                    </div>
                </div>
                <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem; background-color: var(--accent-green); border-color: var(--accent-green); color: white; font-weight: bold; font-size: 1.1rem; padding: 0.8rem;">Calcular Economia</button>
            </form>

            <div id="quick-result-box" class="result-card"></div>
        </div>
    </div>
</div>`;
};

// ---- CONTROLLERS ----
window.handleQuickSim = async (e) => {
    e.preventDefault();
    const kwh = parseFloat(document.getElementById('qsim-kwh').value);
    const supplyClass = document.getElementById('qsim-supply').value;
    const kwhPrice = await db.getGlobalKwhPrice();
    const publicLight = parseFloat(document.getElementById('qsim-light').value);
    
    const value = (kwh * kwhPrice) + publicLight;
    
    let taxaDisp = 30;
    if(supplyClass === 'Bifásico') taxaDisp = 50;
    if(supplyClass === 'Trifásico') taxaDisp = 100;

    let energiaCompensavel = Math.max(0, kwh - taxaDisp);
    
    let eligible = true;
    let discount = kwh > 500 ? 25 : 20;
    
    const coopBill = energiaCompensavel * (1 - (discount / 100)) * kwhPrice;
    const utilityBill = (taxaDisp * kwhPrice) + publicLight;
    const newBill = Math.max(0, coopBill + utilityBill);
    const savings = Math.max(0, value - newBill);
    
    const resultBox = document.getElementById('quick-result-box');
    
    if(eligible) {
        resultBox.className = 'result-card show';
        resultBox.innerHTML = `
            <h3>✅ Viável para Desconto!</h3>
            <div class="result-details" style="font-size: 0.95rem; line-height: 1.6;">
                <strong>Sua Conta Atual:</strong> ${formatCurrency(value)} <br>
                <strong>Consumo Referência:</strong> ${kwh} kWh <br>
                <strong>Energia compensável:</strong> ${energiaCompensavel} kWh <br>
                <strong>Desconto Aplicável:</strong> ${discount}% <br>
                <strong>Fatura Estimada Coopsol:</strong> <span style="font-weight:bold;">${formatCurrency(newBill)}</span>/mês <br>
                <div style="background: rgba(16, 185, 129, 0.1); padding: 0.8rem; margin-top: 0.5rem; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.3);">
                    Economia Limpa: <strong style="color: var(--accent-green); font-size: 1.1rem;">${formatCurrency(savings)}/mês</strong>
                </div>
            </div>
            <div class="result-actions" style="margin-top: 1.5rem;">
                <button class="btn btn-primary" onclick="navigate('simulation')">Avançar para Cadastro de Contrato 👉</button>
            </div>
        `;
    } else {
        resultBox.className = 'result-card not-eligible show';
        resultBox.innerHTML = `
            <h3 style="color: var(--danger);">❌ Conta não atinge o perfil</h3>
            <div class="result-details">
                O consumo de ${kwh} kWh informado não atinge o mínimo (acima de 250 kWh) para ingressar na cooperativa.
            </div>
        `;
    }
};

window.handleLogin = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const pwd = document.getElementById('password').value;
    
    if(!email.toLowerCase().endsWith('@coopsol.com')) {
        alert('Usuário não autorizado.');
        return;
    }
    
    if(await auth.login(email, pwd)) {
        navigate('dashboard');
    } else {
        alert('E-mail ou senha inválidos!');
    }
};

window.handleRegister = async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const pwd = document.getElementById('reg-password').value;
    
    if(!email.toLowerCase().endsWith('@coopsol.com')) {
        const users = await db.getUsers();
        if(!users.find(u => u.email === email)) {
            await db.saveUser({ id: Date.now().toString(), name, email, password: pwd, status: 'Negado' });
        }
        alert('Usuário não autorizado.');
        return;
    }
    
    if(await auth.register(name, email, pwd)) {
        alert('Conta criada! Faça login.');
        navigate('login');
    } else {
        alert('Este e-mail já está em uso.');
    }
};

window.currentSimData = null;

window.handleSimulation = async (e, editId = null) => {
    e.preventDefault();
    const name = document.getElementById('sim-name').value;
    const documentId = document.getElementById('sim-document').value;
    const email = document.getElementById('sim-email').value;
    const address = document.getElementById('sim-address').value;
    const supplyClass = document.getElementById('sim-supply-class').value;
    const kwhPrice = await db.getGlobalKwhPrice();
    const publicLight = parseFloat(document.getElementById('sim-public-light').value);
    const repClass = document.getElementById('sim-rep-class').value;
    
    // Novos campos do Representante Legal
    const repName = document.getElementById('sim-rep-name').value;
    const repCpf = document.getElementById('sim-rep-cpf').value;
    const repNacionality = document.getElementById('sim-rep-nacionality').value;
    const repCivil = document.getElementById('sim-rep-civil').value;
    const repJob = document.getElementById('sim-rep-job').value;
    const repAddress = document.getElementById('sim-rep-address').value;
    const ucNumber = document.getElementById('sim-uc').value;
    const contractStatus = document.getElementById('sim-contract-status').value;
    const temperature = document.getElementById('sim-temperature').value;
    const sellerId = document.getElementById('sim-seller-id') ? document.getElementById('sim-seller-id').value : (currentSimData ? currentSimData.sellerId : currentUser.id);
    
    const billFileInput = document.getElementById('sim-bill-file');
    const billFile = billFileInput.files.length > 0 ? billFileInput.files[0] : null;

    const kwh = parseFloat(document.getElementById('sim-kwh').value);
    const value = (kwh * kwhPrice) + publicLight; // calculate total bill value dynamically
    
    let taxaDisp = 30;
    if(supplyClass === 'Bifásico') taxaDisp = 50;
    if(supplyClass === 'Trifásico') taxaDisp = 100;

    let energiaCompensavel = Math.max(0, kwh - taxaDisp);
    
    let eligible = true;
    let suggestedDiscount = kwh > 500 ? 25 : 20;
    
    let existingDiscount = '';
    if (window.currentSimData && window.currentSimData.discountPercent !== undefined) {
        existingDiscount = window.currentSimData.discountPercent;
    } else {
        const hc = document.getElementById('sim-edit-discount');
        if (hc && hc.value !== '') existingDiscount = parseFloat(hc.value);
    }
    
    let discount = (existingDiscount !== '' && !isNaN(existingDiscount)) ? parseFloat(existingDiscount) : suggestedDiscount;
    
    const coopBill = energiaCompensavel * (1 - (discount / 100)) * kwhPrice;
    const utilityBill = (taxaDisp * kwhPrice) + publicLight;
    const newBill = Math.max(0, coopBill + utilityBill);
    const savings = Math.max(0, value - newBill);
    
    window.currentSimData = { 
        id: editId,
        name, 
        documentId,
        email,
        address,
        supplyClass,
        kwh,
        kwhPrice,
        publicLight,
        repClass,
        repName,
        repCpf,
        repNacionality,
        repCivil,
        repJob,
        repAddress,
        ucNumber,
        contractStatus,
        temperature,
        sellerId,
        billFile,
        billUrl: window.currentSimData ? window.currentSimData.billUrl : null,
        billValue: value, 
        discountPercent: discount, 
        savings,
        energiaCompensavel,
        newBill
    };
    
    const resultBox = document.getElementById('result-box');
    
    if(eligible) {
        resultBox.className = 'result-card show';
        resultBox.innerHTML = `
            <h3>✅ Cliente Elegível!</h3>
            <div class="result-details" style="font-size: 0.95rem; line-height: 1.6;">
                <strong>Consumo Referência:</strong> ${kwh} kWh <br>
                <strong>Energia compensável:</strong> ${energiaCompensavel} kWh <br>
                <strong>Percentual de desconto:</strong> ${discount}% <br>
                <strong>Valor final estimado:</strong> <span id="new-bill-display" style="font-weight:bold;">${formatCurrency(newBill)}</span>/mês <br>
                <div style="background: rgba(16, 185, 129, 0.1); padding: 0.8rem; margin-top: 0.5rem; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.3);">
                    Economia gerada: <strong id="savings-display" style="color: var(--accent-green); font-size: 1.1rem;">${formatCurrency(savings)}/mês</strong>
                </div>
            </div>

            <div class="input-group" style="margin-top: 1.5rem; margin-bottom: 1.5rem; max-width: 250px; background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px;">
                <label>Alterar Desconto (%)</label>
                <input type="number" id="custom-discount" step="0.5" min="0" max="100" value="${discount}" oninput="updateSimSavings()" style="font-size: 1.1rem; font-weight: bold; color: var(--accent-yellow);">
                <small style="color: var(--text-muted); font-size: 0.8rem; margin-top: 0.2rem;">*Sugerido pelo sistema: ${suggestedDiscount}%</small>
            </div>

            <div class="result-actions">
                <button class="btn btn-outline" onclick="saveClient('Em Negociação')">Salvar Em Negociação</button>
                <button class="btn btn-success" onclick="closeContract()">✨ Emitir Contrato e Fechar</button>
            </div>
        `;
    } else {
        resultBox.className = 'result-card not-eligible show';
        resultBox.innerHTML = `
            <h3 style="color: var(--danger);">❌ Não Elegível</h3>
            <div class="result-details">
                O consumo de ${kwh} kWh informado não atinge o mínimo (acima de 250 kWh) para desconto.
            </div>
            <div class="result-actions">
                <button class="btn btn-outline" onclick="saveClient('Em Negociação')">Salvar Em Negociação</button>
            </div>
        `;
    }
};

window.saveClient = async (status) => {
    if(!currentSimData) return;
    
    let clientId = currentSimData.id ? currentSimData.id : Date.now().toString();
    
    // Validação de UC Duplicada
    if (currentSimData.ucNumber) {
        const allClients = await db.getClients();
        const duplicate = allClients.find(c => c.ucNumber === currentSimData.ucNumber && String(c.id) !== String(clientId));
        if (duplicate) {
            return alert(`Erro: Esta Unidade Consumidora (UC: ${currentSimData.ucNumber}) já está cadastrada para o cliente ${duplicate.name}.`);
        }
    }

    // Upload de arquivo
    if(currentSimData.billFile) {
        document.body.insertAdjacentHTML('beforeend', '<div id="global-loader" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;color:white;font-size:1.5rem;font-weight:bold;">Enviando arquivo e salvando...</div>');
        try {
            const url = await db.uploadBillFile(currentSimData.billFile, clientId);
            currentSimData.billUrl = url;
            console.log("Upload Success:", url);
        } catch (e) {
            console.error("Erro no upload", e);
            alert("Erro durante o upload (" + e.message + "). O arquivo não foi anexado. Certifique-se que as configurações de Firebase Storage e Permissões estão corretas.");
        }
    }

    const clientData = {
        id: clientId,
        sellerId: currentSimData.sellerId || currentUser.id,
        name: currentSimData.name,
        documentId: currentSimData.documentId,
        email: currentSimData.email,
        address: currentSimData.address,
        supplyClass: currentSimData.supplyClass,
        kwh: currentSimData.kwh,
        kwhPrice: currentSimData.kwhPrice,
        publicLight: currentSimData.publicLight,
        repClass: currentSimData.repClass,
        repName: currentSimData.repName,
        repCpf: currentSimData.repCpf,
        repNacionality: currentSimData.repNacionality,
        repCivil: currentSimData.repCivil,
        repJob: currentSimData.repJob,
        repAddress: currentSimData.repAddress,
        ucNumber: currentSimData.ucNumber,
        contractStatus: currentSimData.contractStatus,
        billUrl: currentSimData.billUrl || null,
        billValue: currentSimData.billValue,
        status: status,
        discountPercent: currentSimData.discountPercent,
        savings: currentSimData.savings,
        energiaCompensavel: currentSimData.energiaCompensavel,
        newBill: currentSimData.newBill
    };
    
    try {
        await db.saveClient(clientData);
        invalidateCaches();
        
        if(status !== 'Fechado') {
            alert('Cliente salvo na nuvem com sucesso!');
            navigate('dashboard');
        }
    } catch(err) {
        console.error("Database save failed: ", err);
        alert("Falha extrema ao salvar no banco de dados. Tente novamente.");
    } finally {
        const loader = document.getElementById('global-loader');
        if(loader) loader.remove();
    }
};

window.viewClientDetails = async (id) => {
    const clients = await db.getClients();
    const client = clients.find(c => String(c.id) === String(id));
    if(client) {
        navigate('clientView', client);
    }
};

const ViewClientDetailsOnly = async (client) => {
    const isAdmin = isUserAdmin(currentUser);
    let users = isAdmin ? await db.getUsers() : [];
    users.sort((a,b) => (a.name || '').localeCompare(b.name || ''));
    const currentSeller = users.find(u => String(u.id) === String(client.sellerId));
    
    const billUrlLink = client.billUrl ? `<a href="${client.billUrl}" target="_blank" class="btn btn-outline" style="margin-top:1rem; display:inline-block; border-color: var(--accent-primary); color: var(--accent-primary);">👁️ Ver Conta de Luz</a>` : '';

    return `
<div class="app-layout">
    ${Sidebar('dashboard')}
    <div class="main-content">
        <div class="sim-container glass" style="max-width: 800px; margin: 0 auto; animation: fadeInUp 0.4s ease;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid var(--panel-border); padding-bottom: 1rem;">
                <h2 style="margin: 0; font-size: 1.5rem; color: var(--text-main);">Ficha do Cliente</h2>
                <button class="btn btn-outline" onclick="navigate('dashboard')">⬅ Voltar</button>
            </div>

            ${isAdmin ? `
            <!-- Painel Admin - Visualização -->
            <div style="background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                <div style="display: flex; flex-direction: column; align-items: center; text-align: center;">
                    <strong style="color: #a78bfa; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem; display: block;">🛠️ Painel de Gestão (Admin)</strong>
                    <div style="display: flex; gap: 1rem; width: 100%; max-width: 500px; justify-content: center; align-items: flex-end;">
                        <div style="flex: 1; text-align: left;">
                            <label style="display: block; color: var(--text-muted); font-size: 0.75rem; margin-bottom: 0.4rem;">Reatribuir Vendedor Responsável</label>
                            <select id="update-seller-id" style="width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 0.7rem; border-radius: 8px; outline:none; font-size: 0.95rem;">
                                ${users.map(u => `<option value="${u.id}" ${String(u.id) === String(client.sellerId) ? 'selected' : ''}>${u.name}${u.email ? ' ('+u.email+')' : ''}</option>`).join('')}
                            </select>
                        </div>
                        <button class="btn btn-primary" style="height: 42px; padding: 0 1.5rem;" onclick="updateClientSeller('${client.id}')">Atualizar</button>
                    </div>
                </div>
            </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Nome / Razão Social</strong>
                    <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-main);">${client.name}</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Documento (CPF/CNPJ)</strong>
                    <div style="font-size: 1.1rem; font-weight: 500;">${client.documentId}</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">E-mail do Cliente</strong>
                    <div style="font-size: 1.1rem; font-weight: 500;">${client.email || 'Não informado'}</div>
                </div>
                <div style="grid-column: 1 / -1;">
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Endereço da Unidade</strong>
                    <div style="font-size: 1.1rem; font-weight: 500;">${client.address}</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Média Consumo</strong>
                    <div style="font-size: 1.1rem; font-weight: 500;">${client.kwh} kWh</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Classe Fornecimento</strong>
                    <div style="font-size: 1.1rem; font-weight: 500;">${client.supplyClass}</div>
                </div>
                <div style="background: rgba(239, 68, 68, 0.05); padding: 1rem; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.1);">
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Fatura Atual (S/ Coopsol)</strong>
                    <div style="font-size: 1.3rem; font-weight: bold; color: var(--danger);">${formatCurrency(client.billValue)}</div>
                </div>
                <div style="background: rgba(16, 185, 129, 0.05); padding: 1rem; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Nova Fatura (C/ Coopsol)</strong>
                    <div style="font-size: 1.3rem; font-weight: bold; color: var(--accent-green);">${formatCurrency(client.newBill)}</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Desconto Aplicado</strong>
                    <div style="font-size: 1.1rem; font-weight: bold;">${client.discountPercent}%</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Economia Mensal</strong>
                    <div style="font-size: 1.1rem; font-weight: bold; color: var(--accent-green);">${formatCurrency(client.savings)}</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Status Atual</strong>
                    <div style="margin-top: 0.3rem;"><span class="status-badge status-${client.status.toLowerCase().replace(/ /g,'-')}">${client.status}</span></div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Status do Contrato</strong>
                    <div style="margin-top: 0.3rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <span id="contract-status-badge-${client.id}" class="status-badge" style="${getContractStatusStyle(client.contractStatus)}">${client.contractStatus || 'Em preparação'}</span>
                        ${client.autentiqueDocId ? `<button onclick="checkContractStatus('${client.id}', '${client.autentiqueDocId}')" style="font-size:0.75rem; padding:0.2rem 0.6rem; border-radius:6px; border:1px solid var(--accent-primary); background:transparent; color:var(--accent-primary); cursor:pointer;" title="Consultar Autentique">🔄 Verificar</button>` : ''}
                    </div>
                    ${client.contractSentAt ? `<div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem;">Enviado em ${new Date(client.contractSentAt).toLocaleDateString('pt-BR')}</div>` : ''}
                    ${client.contractSignedAt ? `<div style="font-size:0.75rem; color:#10b981; margin-top:0.1rem;">✅ Assinado em ${new Date(client.contractSignedAt).toLocaleDateString('pt-BR')}</div>` : ''}
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Nº Unidade Consumidora / Instalação</strong>
                    <div style="font-size: 1.1rem; font-weight: 500;">${client.ucNumber || 'Não informado'}</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">🔥 Temperatura do Lead</strong>
                    <div style="font-size: 1.1rem; font-weight: bold; color: ${client.temperature === 'Quente' ? '#ef4444' : (client.temperature === 'Morno' ? '#f59e0b' : '#3b82f6')};">${client.temperature || 'Morna'}</div>
                </div>
            </div>

            <div style="display: flex; gap: 1rem; margin-bottom: 2rem;">
                ${client.billUrl ? `<a href="${client.billUrl}" target="_blank" class="btn btn-outline" style="flex: 1; border-color: var(--accent-primary); color: var(--accent-primary); text-decoration: none; text-align: center; display: flex; align-items: center; justify-content: center; gap: 0.5rem;"><span>👁️</span> Ver Conta de Luz Anexada</a>` : ''}
            </div>

            <div style="border-top: 1px solid var(--panel-border); padding-top: 1.5rem;">
                <h3 style="margin-bottom: 1rem; font-size: 1.1rem; color: var(--text-main);">Dados Complementares</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                    <div>
                        <strong style="color: var(--text-muted); font-size: 0.85rem;">Pessoa Rep.</strong>
                        <div style="font-size: 1rem;">${client.repClass}</div>
                    </div>
                    ${client.repClass === 'Pessoa Jurídica' ? `
                    <div>
                        <strong style="color: var(--text-muted); font-size: 0.85rem;">Rep. Legal</strong>
                        <div style="font-size: 1rem;">${client.repName}</div>
                    </div>
                    <div>
                        <strong style="color: var(--text-muted); font-size: 0.85rem;">CPF Rep.</strong>
                        <div style="font-size: 1rem;">${client.repCpf}</div>
                    </div>
                    ` : ''}
                </div>
                ${billUrlLink}
            </div>
            
            <div style="margin-top: 2rem; display: flex; gap: 1rem;">
                <button class="btn btn-outline" style="flex:1;" onclick="reactivateClient('${client.id}')">✏️ Editar Cliente</button>
            </div>
        </div>
    </div>
</div>`;
};

window.deactivateClient = async (id) => {
    if(confirm('Tem certeza que deseja marcar este cliente como Perdida?')) {
        const allClients = await db.getClients();
        const client = allClients.find(c => String(c.id) === String(id));
        if(client) {
            client.status = 'Perdida';
            await db.saveClient(client);
            invalidateCaches();
            navigate('clients');
        } else {
            alert('Erro: Cliente não encontrado no banco de dados local com ID: ' + id);
        }
    }
};

window.reactivateClient = async (id) => {
    const clients = await db.getClients();
    const idx = clients.findIndex(c => String(c.id) === String(id));
    if(idx !== -1) {
        navigate('simulation', clients[idx]);
    } else {
        alert('Erro: Cliente não encontrado (ID: ' + id + ')');
    }
};

window.deleteClient = async (id) => {
    if(confirm('Passo 1/2: Você está prestes a excluir este cliente permanentemente. Continuar?')) {
        if(confirm('Passo 2/2: EXCLUSÃO PERMANENTE. Confirmar EXCLUSÃO?')) {
            await db.deleteClient(id);
            invalidateCaches();
            navigate('clients');
        }
    }
};

window.toggleUserStatus = async (id, newStatus) => {
    if(confirm(`Tem certeza que deseja mudar o acesso deste usuário para ${newStatus}?`)) {
        const users = await db.getUsers();
        let user = users.find(u => String(u.id) === String(id));
        if(user) {
            user.status = newStatus;
            await db.saveUser(user);
            navigate('dashboard');
        } else {
            alert('Erro: Usuário não encontrado.');
        }
    }
};




window.updateSimSavings = () => {
    if(!currentSimData) return;
    const inputEl = document.getElementById('custom-discount');
    const newDiscount = parseFloat(inputEl.value) || 0;
    
    let taxaDisp = 30;
    if(currentSimData.supplyClass === 'Bifásico') taxaDisp = 50;
    if(currentSimData.supplyClass === 'Trifásico') taxaDisp = 100;
    
    const coopBill = currentSimData.energiaCompensavel * (1 - (newDiscount / 100)) * currentSimData.kwhPrice;
    const utilityBill = (taxaDisp * currentSimData.kwhPrice) + currentSimData.publicLight;
    
    const newBill = Math.max(0, coopBill + utilityBill);
    const newSavings = Math.max(0, currentSimData.billValue - newBill);
    
    currentSimData.discountPercent = newDiscount;
    currentSimData.savings = newSavings;
    currentSimData.newBill = newBill;
    
    const savingsEl = document.getElementById('savings-display');
    const newBillEl = document.getElementById('new-bill-display');
    
    if(savingsEl) savingsEl.innerText = formatCurrency(newSavings) + '/mês';
    if(newBillEl) newBillEl.innerText = formatCurrency(newBill);
};

window.updateGlobalKwhPrice = async () => {
    const val = parseFloat(document.getElementById('admin-global-kwh').value);
    if(isNaN(val)) return alert('Por favor, informe um valor válido.');
    await db.setGlobalKwhPrice(val);
    alert('Preço Global Atualizado com Sucesso!');
};

window.updateDashboardFilters = async (search, status, sellerId) => {
    currentFilters = { search, status, sellerId };

    const isAdmin = isUserAdmin(currentUser);
    
    // Pega dados do cache (quase instantâneo)
    const allClients = await getClientsData();
    const users = isAdmin ? await getUsersData() : [];

    let filtered = allClients;
    if(!isAdmin) {
        filtered = filtered.filter(c => c.sellerId === currentUser.id);
    } else if(sellerId !== 'all') {
        filtered = filtered.filter(c => String(c.sellerId) === String(sellerId));
    }

    if(status !== 'all') {
        filtered = filtered.filter(c => c.status.toLowerCase() === status.toLowerCase());
    }

    if(search) {
        const s = search.toLowerCase();
        filtered = filtered.filter(c => 
            c.name.toLowerCase().includes(s) || 
            (c.documentId && c.documentId.includes(s))
        );
    }

    const tbody = document.getElementById('clients-table-body');
    if (tbody) {
        // ATUALIZAÇÃO CIRÚRGICA: Apenas o corpo da tabela muda. 
        // O campo de busca lá em cima continua intacto, sem perder o foco ou sofrer piscada.
        tbody.innerHTML = renderClientRows(filtered, isAdmin, users) || '<tr><td colspan="7" style="text-align:center; padding: 2rem;">Nenhum cliente encontrado com os filtros aplicados.</td></tr>';
    }
};

window.updateCommissionFilter = (vendedorId) => {
    commissionFilters.sellerId = vendedorId;
    navigate('commissions');
};

window.toggleAnalyticsUnit = () => {
    analyticsUnit = analyticsUnit === 'kWh' ? 'BRL' : 'kWh';
    navigate('analytics');
};

window.toggleSellerRecurrence = async (sellerId, newHasRecurrence) => {
    try {
        const btn = document.getElementById('btn-rec-' + sellerId);
        if (btn) btn.innerHTML = 'Salvando...';

        const users = await db.getUsers();
        const user = users.find(u => String(u.id) === String(sellerId));
        if (!user) return alert('Vendedor não encontrado.');
        user.hasRecurrence = newHasRecurrence;
        await db.saveUser(user);
        invalidateCaches();

        if (btn) {
            const hasRec = newHasRecurrence;
            btn.innerHTML = hasRec ? '✅ Com Recorrência' : '❌ Sem Recorrência';
            btn.style.borderColor = hasRec ? '#10b981' : '#64748b';
            btn.style.background = hasRec ? 'rgba(16,185,129,0.12)' : 'rgba(100,116,139,0.10)';
            btn.style.color = hasRec ? '#10b981' : '#94a3b8';
            btn.setAttribute('onclick', `toggleSellerRecurrence('${sellerId}', ${!hasRec})`);
        }
    } catch(e) {
        alert('Erro ao atualizar configuração de recorrência: ' + e.message);
    }
};

window.updateContractStatus = async (id, status) => {
    try {
        await db.saveClient({ id, contractStatus: status });
        invalidateCaches();
        alert('Status do contrato atualizado!');
    } catch(e) { alert('Erro ao atualizar status'); }
};

window.updateClientTemperature = async (id, temp) => {
    try {
        await db.saveClient({ id, temperature: temp });
        invalidateCaches();
        alert('Temperatura do lead atualizada!');
        navigate('clients');
    } catch(e) { alert('Erro ao atualizar temperatura'); }
};

window.updateClientSeller = async (id) => {
    const newSellerId = document.getElementById('update-seller-id').value;
    if(!newSellerId) return alert('Selecione um vendedor.');
    try {
        await db.saveClient({ id, sellerId: newSellerId });
        invalidateCaches();
        alert('Vendedor responsável atualizado!');
        navigate('clients');
    } catch(e) { alert('Erro ao atualizar vendedor'); }
};

window.saveClientMetadataOnly = async (id) => {
    const data = {
        id,
        name: document.getElementById('sim-name').value,
        documentId: document.getElementById('sim-document').value,
        email: document.getElementById('sim-email').value,
        address: document.getElementById('sim-address').value,
        ucNumber: document.getElementById('sim-uc').value,
        contractStatus: document.getElementById('sim-contract-status').value,
        temperature: document.getElementById('sim-temperature').value,
        repClass: document.getElementById('sim-rep-class').value,
    };

    // Validação de UC Duplicada
    if (data.ucNumber) {
        const allClients = await db.getClients();
        const duplicate = allClients.find(c => c.ucNumber === data.ucNumber && String(c.id) !== String(id));
        if (duplicate) {
            return alert(`Erro: Esta Unidade Consumidora (UC: ${data.ucNumber}) já está cadastrada para o cliente ${duplicate.name}.`);
        }
    }
    try {
        await db.saveClient(data);
        invalidateCaches();
        alert('Dados salvos com sucesso!');
        navigate('clients');
    } catch(e) { alert('Erro ao salvar dados'); }
};

window.handleDeleteUser = async (id, name) => {
    const clients = (await db.getClients()).filter(c => String(c.sellerId) === String(id));
    
    if (clients.length === 0) {
        if (!confirm(`Deseja excluir o vendedor ${name}?`)) return;
        await db.deleteUser(id);
        alert('Vendedor excluído!');
        navigate('dashboard');
        return;
    }

    const users = (await db.getUsers()).filter(u => String(u.id) !== String(id));
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'delete-user-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <h3 class="modal-title">📦 Excluir Vendedor</h3>
            <p class="modal-text">O vendedor <strong>${name}</strong> possui <strong>${clients.length}</strong> clientes vinculados. O que deseja fazer?</p>
            
            <div class="modal-actions">
                <button class="btn btn-outline" style="color:var(--danger); border-color:var(--danger); padding:0.8rem;" onclick="executeDeleteUser('${id}', 'all')">🗑️ Excluir Vendedor e Clientes</button>
                
                <div style="margin-top:1.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top:1.5rem; text-align:left;">
                    <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.8rem;">Ou sugerimos <strong>realocar</strong> clientes para:</p>
                    <div style="display:flex; gap:0.5rem; align-items:center;">
                        <select id="relocate-target" style="flex:1; padding:0.8rem; border-radius:12px; background:rgba(255,255,255,0.05); color:white; border:1px solid rgba(255,255,255,0.1); outline:none;">
                            ${users.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
                        </select>
                        <button class="btn btn-primary" style="padding:0.8rem 1.2rem; min-width:unset; width:auto;" onclick="executeDeleteUser('${id}', 'relocate')">Realocar</button>
                    </div>
                </div>
                
                <button class="btn btn-outline" style="margin-top:1rem; border:none; color:var(--text-muted);" onclick="document.getElementById('delete-user-modal').remove()">Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
};

window.executeDeleteUser = async (oldId, action) => {
    try {
        if (action === 'all') {
            if (!confirm('ATENÇÃO: Isso excluirá permanentemente o vendedor e TODOS os seus clientes. Esta ação é irreversível. Confirma?')) return;
            await db.deleteClientsBySeller(oldId);
        } else if (action === 'relocate') {
            const newId = document.getElementById('relocate-target').value;
            if(!newId) return alert('Selecione um vendedor para realocar.');
            await db.reassignClientsBySeller(oldId, newId);
        }
        
        await db.deleteUser(oldId);
        alert('Operação concluída com sucesso!');
        document.getElementById('delete-user-modal')?.remove();
        navigate('dashboard');
    } catch(e) {
        console.error(e);
        alert('Erro ao processar exclusão');
    }
};

const ViewAnalytics = async () => {
    const clients = await db.getClients();
    const users = await db.getUsers();
    
    // Filtros e Cálculos
    const closedClients = clients.filter(c => c.status === 'Fechado' || c.status === 'Convertido');
    const negClients = clients.filter(c => c.status === 'Em Negociação' || c.status === 'Em negociação' || c.status === 'Lead');
    const lostClients = clients.filter(c => c.status === 'Perdida' || c.status === 'Desativado');

    const totalKwhClosed = closedClients.reduce((acc, c) => acc + (parseFloat(c.kwh) || 0), 0);
    const totalKwhNeg = negClients.reduce((acc, c) => acc + (parseFloat(c.kwh) || 0), 0);
    const totalKwhLost = lostClients.reduce((acc, c) => acc + (parseFloat(c.kwh) || 0), 0);

    const ticketMedio = closedClients.length > 0 ? (totalKwhClosed / closedClients.length) : 0;
    const conversionRate = clients.length > 0 ? (closedClients.length / clients.length) * 100 : 0;
    
    const factor = await db.getGlobalKwhPrice();
    const valClosed = totalKwhClosed * factor;
    const valNeg = totalKwhNeg * factor;
    const valLost = totalKwhLost * factor;

    // ==========================================
    // ANÁLISE DE DESCONTOS
    // ==========================================
    const allActiveDiscounts = clients.filter(c => c.status !== 'Perdida' && c.status !== 'Desativado' && c.discountPercent);
    const discountBucketsSold = {};
    const discountKwhBucketsSold = {};
    const discountBucketsNeg = {};
    const discountKwhBucketsNeg = {};

    // Coletar todos os descontos únicos dinamicamente para acabar com o grupo "Outros"
    const uniqueDiscounts = new Set();
    allActiveDiscounts.forEach(c => {
        const d = parseFloat(c.discountPercent) || 0;
        if (d > 0) uniqueDiscounts.add(d);
    });

    const sortedDiscounts = Array.from(uniqueDiscounts).sort((a, b) => a - b);
    sortedDiscounts.forEach(d => {
        const label = d + '%';
        discountBucketsSold[label] = 0;
        discountKwhBucketsSold[label] = 0;
        discountBucketsNeg[label] = 0;
        discountKwhBucketsNeg[label] = 0;
    });

    let totalEconomiaNegociando = 0;

    allActiveDiscounts.forEach(c => {
        const d = parseFloat(c.discountPercent) || 0;
        const cKwh = parseFloat(c.kwh) || 0;
        const isSold = (c.status === 'Fechado' || c.status === 'Convertido');
        const isNeg = (c.status === 'Em negociação' || c.status === 'Em Negociação' || c.status === 'Lead');
        
        if (isNeg) {
            totalEconomiaNegociando += (parseFloat(c.savings) || 0);
        }

        if (d > 0) {
            const label = d + '%';
            if (isSold) {
                discountBucketsSold[label]++; 
                discountKwhBucketsSold[label] += cKwh; 
            } else if (isNeg) {
                discountBucketsNeg[label]++; 
                discountKwhBucketsNeg[label] += cKwh; 
            }
        }
    });

    // ==========================================
    // ANÁLISE DE LUCRO
    // Com recorrência: Lucro = Receita Líquida - Custo Usineiro (55%) - Recorrência Vendedor (5% fatura)
    // Sem recorrência: Empresa fica com apenas 10% da receita bruta (taxa administrativa)
    // ==========================================
    let totalReceitaBruta = 0;
    let totalCustoUsineiro = 0;
    let totalCustoVendedor = 0;
    let totalDescontoCliente = 0;
    let totalLucro = 0;

    const profitRows = closedClients.map(c => {
        const kwh = parseFloat(c.kwh) || 0;
        const kwhPriceClient = parseFloat(c.kwhPrice) || factor;
        const discountPercent = parseFloat(c.discountPercent) || 0;
        let taxaDisp = 30;
        if (c.supplyClass === 'Bifasico' || c.supplyClass === 'Bifásico') taxaDisp = 50;
        if (c.supplyClass === 'Trifasico' || c.supplyClass === 'Trifásico') taxaDisp = 100;
        const energiaComp = parseFloat(c.energiaCompensavel) || Math.max(0, kwh - taxaDisp);
        const bill = parseFloat(c.billValue) || 0;
        const savings = parseFloat(c.savings) || 0;

        const seller = users.find(u => String(u.id) === String(c.sellerId));
        const sellerName = seller?.name || 'Desconhecido';
        const sellerHasRecurrence = seller?.hasRecurrence !== false;

        const receitaBruta = energiaComp * kwhPriceClient;
        const receitaLiquida = receitaBruta * (1 - discountPercent / 100);
        const custoUsineiro = receitaBruta * 0.55;
        const descontoCliente = savings;

        let custoVendedor = 0;
        let lucro = 0;
        let modeloLabel = '';

        if (sellerHasRecurrence) {
            // Modelo padrão: paga 5% de recorrência ao vendedor
            custoVendedor = bill * 0.05;
            lucro = receitaLiquida - custoUsineiro - custoVendedor;
            modeloLabel = '5% rec.';
        } else {
            // Modelo sem recorrência: empresa fica com 10% da receita bruta (taxa admin)
            custoVendedor = 0;
            lucro = receitaBruta * 0.10;
            modeloLabel = '10% adm.';
        }

        totalReceitaBruta += receitaLiquida;
        totalCustoUsineiro += custoUsineiro;
        totalCustoVendedor += custoVendedor;
        totalDescontoCliente += descontoCliente;
        totalLucro += lucro;

        const lucroColor = lucro >= 0 ? '#10b981' : '#ef4444';
        const modeloBadge = sellerHasRecurrence
            ? `<span style="font-size:0.65rem;background:rgba(167,139,250,0.15);color:#a78bfa;padding:0.1rem 0.4rem;border-radius:8px;">REC</span>`
            : `<span style="font-size:0.65rem;background:rgba(245,158,11,0.15);color:#f59e0b;padding:0.1rem 0.4rem;border-radius:8px;">ADM 10%</span>`;

        return `
        <tr>
            <td>
                <strong>${c.name}</strong>
                <br><small style="color:var(--text-muted)">${sellerName} ${modeloBadge} · Desc: ${discountPercent}%</small>
            </td>
            <td style="text-align:right">${energiaComp.toLocaleString('pt-BR')} kWh</td>
            <td style="text-align:right; color: #10b981; font-weight:600">${formatCurrency(receitaLiquida)}<br><small style="color:var(--text-muted)">(desc. ${discountPercent}%)</small></td>
            <td style="text-align:right; color: #f59e0b">${formatCurrency(custoUsineiro)}<br><small>55% bruto</small></td>
            <td style="text-align:right; color: #a78bfa">${custoVendedor > 0 ? formatCurrency(custoVendedor) : '—'}<br><small>${modeloLabel}</small></td>
            <td style="text-align:right; color: #64748b">${formatCurrency(descontoCliente)}</td>
            <td style="text-align:right; font-weight:800; font-size:1rem; color:${lucroColor}">${formatCurrency(lucro)}</td>
        </tr>`;
    }).join('');

    // Margem calculada sobre a receita líquida (já com desconto aplicado)
    const margemLiquida = totalReceitaBruta > 0 ? (totalLucro / totalReceitaBruta) * 100 : 0;
    
    // Receita Teórica = O valor bruto "cheio" caso todo o desconto nunca fosse dado. Usado para a roda de composição total.
    const receitaTeorica = totalReceitaBruta + totalDescontoCliente;

    // Dados por Vendedor
    const sellerPerformance = users.map(u => {
        const soldKwh = clients.filter(c => String(c.sellerId) === String(u.id) && (c.status === 'Fechado' || c.status === 'Convertido'))
                               .reduce((acc, c) => acc + (parseFloat(c.kwh) || 0), 0);
        const negKwh = clients.filter(c => String(c.sellerId) === String(u.id) && (c.status.toLowerCase() === 'em negociação' || c.status.toLowerCase() === 'lead'))
                              .reduce((acc, c) => acc + (parseFloat(c.kwh) || 0), 0);
        return { 
            name: u.name, 
            sold: analyticsUnit === 'kWh' ? soldKwh : soldKwh * factor,
            negotiating: analyticsUnit === 'kWh' ? negKwh : negKwh*factor
        };
    }).sort((a, b) => b.sold - a.sold).slice(0, 5);

    // Status do Contrato
    const statusCounts = {
        'Em preparação': clients.filter(c => c.contractStatus === 'Em preparação' || !c.contractStatus).length,
        'Pronto': clients.filter(c => c.contractStatus === 'Pronto').length,
        'Aguardando assinatura': clients.filter(c => c.contractStatus === 'Aguardando assinatura').length,
        'Assinado': clients.filter(c => c.contractStatus === 'Assinado').length
    };

    setTimeout(() => {
        // Grafico 1: Volume por Status
        const ctx1 = document.getElementById('volumeChart').getContext('2d');
        new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: ['Fechado', 'Em Negociação', 'Perdido'],
                datasets: [{
                    label: analyticsUnit,
                    data: [
                        analyticsUnit === 'kWh' ? totalKwhClosed : valClosed,
                        analyticsUnit === 'kWh' ? totalKwhNeg : valNeg,
                        analyticsUnit === 'kWh' ? totalKwhLost : valLost
                    ],
                    backgroundColor: ['#10b981', '#f59e0b', '#94a3b8']
                }]
            },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });

        // Grafico 2: Vendedores
        const ctx2 = document.getElementById('sellerChart').getContext('2d');
        new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: sellerPerformance.map(s => s.name),
                datasets: [
                    {
                        label: 'Vendido',
                        data: sellerPerformance.map(s => s.sold),
                        backgroundColor: '#3b82f6'
                    },
                    {
                        label: 'Negociando',
                        data: sellerPerformance.map(s => s.negotiating),
                        backgroundColor: '#f59e0b'
                    }
                ]
            },
            options: { 
                indexAxis: 'y', 
                responsive: true, 
                scales: {
                    x: { stacked: true },
                    y: { stacked: true }
                },
                plugins: { legend: { display: true } } 
            }
        });

        // Grafico 3: Status Contrato
        const ctx3 = document.getElementById('contractChart').getContext('2d');
        new Chart(ctx3, {
            type: 'doughnut',
            data: {
                labels: Object.keys(statusCounts),
                datasets: [{
                    data: Object.values(statusCounts),
                    backgroundColor: ['#64748b', '#f59e0b', '#3b82f6', '#10b981']
                }]
            },
            options: { responsive: true, cutout: '70%' }
        });

        // Grafico 4: Composicao do Lucro
        const ctx4El = document.getElementById('profitChart');
        if (ctx4El) {
            const ctx4 = ctx4El.getContext('2d');
            new Chart(ctx4, {
                type: 'doughnut',
                data: {
                    labels: ['Lucro Liquido', 'Custo Usineiro', 'Rec. Vendedor', 'Desconto Cliente'],
                    datasets: [{
                        data: [Math.max(0, totalLucro), totalCustoUsineiro, totalCustoVendedor, totalDescontoCliente],
                        backgroundColor: ['#10b981', '#f59e0b', '#a78bfa', '#64748b'],
                        borderWidth: 2,
                        borderColor: 'rgba(255,255,255,0.08)'
                    }]
                },
                options: {
                    responsive: true,
                    cutout: '65%',
                    plugins: {
                        legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 12, font: { size: 11 } } },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => ` ${ctx.label}: R$ ${ctx.raw.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}`
                            }
                        }
                    }
                }
            });
        }

        // Grafico 5: Distribuicao de Descontos
        const ctx5El = document.getElementById('discountChart');
        if (ctx5El) {
            const ctx5 = ctx5El.getContext('2d');
            new Chart(ctx5, {
                type: 'bar',
                data: {
                    labels: Object.keys(discountBucketsSold),
                    datasets: [
                        { label: 'Vendido', data: Object.values(discountBucketsSold), backgroundColor: '#3b82f6', borderRadius: 4 },
                        { label: 'Em Negociação', data: Object.values(discountBucketsNeg), backgroundColor: '#f59e0b', borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { stacked: true },
                        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } }
                    },
                    plugins: {
                        legend: { display: true }
                    }
                }
            });
        }

        // Grafico 6: Volume (kWh) por Desconto
        const ctx6El = document.getElementById('discountKwhChart');
        if (ctx6El) {
            const ctx6 = ctx6El.getContext('2d');
            new Chart(ctx6, {
                type: 'bar',
                data: {
                    labels: Object.keys(discountKwhBucketsSold),
                    datasets: [
                        { label: 'Vendido', data: Object.values(discountKwhBucketsSold), backgroundColor: '#8b5cf6', borderRadius: 4 },
                        { label: 'Em Negociação', data: Object.values(discountKwhBucketsNeg), backgroundColor: '#f59e0b', borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true,
                    scales: {
                        x: { stacked: true },
                        y: { stacked: true, beginAtZero: true }
                    },
                    plugins: {
                        legend: { display: true },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => ` ${ctx.label}: ${ctx.raw.toLocaleString('pt-BR')} kWh`
                            }
                        }
                    }
                }
            });
        }
    }, 100);

    return `
    <div class="app-layout">
        ${Sidebar('analytics')}
        <div class="main-content">
            <div class="header">
                <div>
                    <h2 style="margin:0;">Dashboard Analytics</h2>
                    <p style="color:var(--text-muted); font-size:0.9rem;">Visão geral de performance e conversões</p>
                </div>
            </div>
            
            <div class="stats-grid" style="margin-bottom: 2rem;">
                <div class="stat-card glass">
                    <span class="label">Total Faturado (Estimado)</span>
                    <span class="value" style="color:var(--accent-green);">${formatCurrency(valClosed)}</span>
                    <small style="color:var(--text-muted);">Base: ${totalKwhClosed.toLocaleString()} kWh</small>
                </div>
                <div class="stat-card glass">
                    <span class="label">Ticket Médio</span>
                    <span class="value">${ticketMedio.toFixed(0)} <small style="font-size:1rem;">kWh/cli</small></span>
                    <small style="color:var(--text-muted);">Valor médio: ${formatCurrency(ticketMedio * factor)}</small>
                </div>
                <div class="stat-card glass">
                    <span class="label">Taxa de Conversão</span>
                    <span class="value" style="color:var(--accent-primary);">${conversionRate.toFixed(1)}%</span>
                    <small style="color:var(--text-muted);">${closedClients.length} fechados de ${clients.length}</small>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1.5rem;">
                <div class="table-container glass">
                    <h3 style="font-size:1rem; margin-bottom:1.5rem;">Volume por Status do Lead (${analyticsUnit})</h3>
                    <canvas id="volumeChart" height="180"></canvas>
                </div>
                
                <div class="table-container glass">
                    <h3 style="font-size:1rem; margin-bottom:1.5rem;">Top Vendedores (Volume ${analyticsUnit})</h3>
                    <canvas id="sellerChart" height="180"></canvas>
                </div>

                <div class="table-container glass">
                    <h3 style="font-size:1rem; margin-bottom:1.5rem;">Status dos Contratos (Qtd)</h3>
                    <div style="max-width: 280px; margin: 0 auto;">
                        <canvas id="contractChart"></canvas>
                    </div>
                </div>

                <div class="table-container glass" style="display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center;">
                    <h3 style="font-size:1rem; margin-bottom:1rem;">Potencial em Negociação</h3>
                    <div style="font-size:2.5rem; font-weight:800; color:var(--accent-yellow);">${analyticsUnit === 'kWh' ? totalKwhNeg.toLocaleString() + ' kWh' : formatCurrency(valNeg)}</div>
                    <p style="color:var(--text-muted); margin-top:0.5rem;">Existem ${negClients.length} leads ativos que podem gerar este volume.</p>
                </div>
            </div>

            <!-- ===== SECAO ANALISE DE DESCONTOS ===== -->
            <div style="margin-top: 2.5rem;">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--panel-border);">
                    <div style="width: 4px; height: 36px; background: linear-gradient(to bottom, #3b82f6, #2563eb); border-radius: 2px; flex-shrink:0;"></div>
                    <div>
                        <h2 style="margin: 0; font-size: 1.4rem;">📉 Análise de Descontos </h2>
                        <p style="color: var(--text-muted); font-size: 0.82rem; margin: 0.2rem 0 0;">Distribuição dos descontos aplicados nos contratos ativos e economia gerada.</p>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                    <div class="stat-card glass" style="border-left: 3px solid #3b82f6;">
                        <span class="label">Desconto Médio (Vendido)</span>
                        <span class="value" style="color: #3b82f6; font-size: 1.8rem;">${(receitaTeorica > 0 ? (totalDescontoCliente / receitaTeorica) * 100 : 0).toFixed(1)}%</span>
                        <small style="color: var(--text-muted);">Eqv. Financeiro q incide no Lucro</small>
                    </div>
                    <div class="stat-card glass" style="border-left: 3px solid #f59e0b;">
                        <span class="label">Projeção R$ (Em Negociação)</span>
                        <span class="value" style="color: #f59e0b; font-size: 1.8rem;">${formatCurrency(totalEconomiaNegociando)}</span>
                        <small style="color: var(--text-muted);">Descontos que podem ser fechados</small>
                    </div>
                    <div class="stat-card glass" style="border-left: 3px solid #64748b;">
                        <span class="label">R$ Economizado (Vendido)</span>
                        <span class="value" style="color: #64748b; font-size: 1.8rem;">${formatCurrency(totalDescontoCliente)}</span>
                        <small style="color: var(--text-muted);">Entregue aos clientes fechados</small>
                    </div>
                    <div class="stat-card glass" style="border-left: 3px solid #ef4444;">
                        <span class="label">Impacto no Faturamento</span>
                        <span class="value" style="color: #ef4444; font-size: 1.8rem;">${formatCurrency(totalDescontoCliente)}</span>
                        <small style="color: var(--text-muted);">Dinheiro "deixado na mesa" hoje</small>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem;">
                    <div class="table-container glass">
                        <h3 style="font-size: 1rem; margin-bottom: 1rem;">Distribuição de Descontos (Clientes)</h3>
                        <canvas id="discountChart" height="200"></canvas>
                    </div>
                    <div class="table-container glass">
                        <h3 style="font-size: 1rem; margin-bottom: 1rem;">Volume Comprometido (kWh)</h3>
                        <canvas id="discountKwhChart" height="200"></canvas>
                    </div>
                </div>
            </div>

            <!-- ===== SECAO ANALISE DE LUCRO ===== -->
            <div style="margin-top: 2.5rem;">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--panel-border);">
                    <div style="width: 4px; height: 36px; background: linear-gradient(to bottom, #10b981, #059669); border-radius: 2px; flex-shrink:0;"></div>
                    <div>
                        <h2 style="margin: 0; font-size: 1.4rem;">💰 Análise de Lucro</h2>
                        <p style="color: var(--text-muted); font-size: 0.82rem; margin: 0.2rem 0 0;">Composição financeira dos contratos fechados &middot; Usineiro 55% &middot; Recorrência Vendedor 5%</p>
                    </div>
                </div>

                <!-- KPI Cards de lucro -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
                    <div class="stat-card glass" style="border-left: 3px solid #10b981;">
                        <span class="label">💵 Receita Líquida</span>
                        <span class="value" style="color: #10b981; font-size: 1.5rem;">${formatCurrency(totalReceitaBruta)}</span>
                        <small style="color: var(--text-muted);">kWh comp. × preço com desconto</small>
                    </div>
                    <div class="stat-card glass" style="border-left: 3px solid #f59e0b;">
                        <span class="label">⚡ Custo Usineiro</span>
                        <span class="value" style="color: #f59e0b; font-size: 1.5rem;">${formatCurrency(totalCustoUsineiro)}</span>
                        <small style="color: var(--text-muted);">55% às geradoras</small>
                    </div>
                    <div class="stat-card glass" style="border-left: 3px solid #a78bfa;">
                        <span class="label">🤝 Rec. Vendedores</span>
                        <span class="value" style="color: #a78bfa; font-size: 1.5rem;">${formatCurrency(totalCustoVendedor)}</span>
                        <small style="color: var(--text-muted);">5% mensal por cliente</small>
                    </div>
                    <div class="stat-card glass" style="border-left: 3px solid #64748b;">
                        <span class="label">🎁 Desconto Clientes</span>
                        <span class="value" style="color: #64748b; font-size: 1.5rem;">${formatCurrency(totalDescontoCliente)}</span>
                        <small style="color: var(--text-muted);">Economia gerada total</small>
                    </div>
                    <div class="stat-card glass conversions" style="border-left: 3px solid #10b981;">
                        <span class="label">🏆 Lucro Líquido</span>
                        <span class="value" style="font-size: 1.7rem; font-weight: 900; color: ${totalLucro >= 0 ? '#10b981' : '#ef4444'};">${formatCurrency(totalLucro)}</span>
                        <small style="color: var(--text-muted);">Margem: ${margemLiquida.toFixed(1)}%</small>
                    </div>
                </div>

                <!-- Grafico + Tabela lado a lado -->
                <div style="display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 1.5rem; align-items: start;">

                    <!-- Grafico pizza composicao -->
                    <div class="table-container glass" style="text-align: center;">
                        <h3 style="font-size: 1rem; margin-bottom: 1rem;">Composição da Receita</h3>
                        <div style="max-width: 260px; margin: 0 auto;">
                            <canvas id="profitChart"></canvas>
                        </div>
                        <div style="margin-top: 1.2rem; display: flex; flex-direction: column; gap: 0.5rem;">
                            <div style="display:flex; justify-content:space-between; font-size:0.82rem; padding:0.5rem 0.8rem; background:rgba(16,185,129,0.08); border-radius:8px; border:1px solid rgba(16,185,129,0.2);">
                                <span style="color:#10b981;">● Lucro Líquido</span>
                                <strong style="color:#10b981;">${receitaTeorica > 0 ? ((totalLucro/receitaTeorica)*100).toFixed(1) : 0}%</strong>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:0.82rem; padding:0.5rem 0.8rem; background:rgba(245,158,11,0.08); border-radius:8px; border:1px solid rgba(245,158,11,0.2);">
                                <span style="color:#f59e0b;">● Custo Usineiro</span>
                                <strong style="color:#f59e0b;">${receitaTeorica > 0 ? ((totalCustoUsineiro/receitaTeorica)*100).toFixed(1) : 0}%</strong>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:0.82rem; padding:0.5rem 0.8rem; background:rgba(167,139,250,0.08); border-radius:8px; border:1px solid rgba(167,139,250,0.2);">
                                <span style="color:#a78bfa;">● Rec. Vendedor</span>
                                <strong style="color:#a78bfa;">${receitaTeorica > 0 ? ((totalCustoVendedor/receitaTeorica)*100).toFixed(1) : 0}%</strong>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:0.82rem; padding:0.5rem 0.8rem; background:rgba(100,116,139,0.08); border-radius:8px; border:1px solid rgba(100,116,139,0.2);">
                                <span style="color:#64748b;">● Desconto Cliente</span>
                                <strong style="color:#64748b;">${receitaTeorica > 0 ? ((totalDescontoCliente/receitaTeorica)*100).toFixed(1) : 0}%</strong>
                            </div>
                        </div>
                    </div>

                    <!-- Tabela detalhada por cliente -->
                    <div class="table-container glass" style="overflow-x: auto;">
                        <h3 style="font-size: 1rem; margin-bottom: 1.2rem;">Detalhamento por Cliente Fechado</h3>
                        ${closedClients.length > 0 ? `
                        <table class="client-list" style="font-size: 0.82rem; min-width: 680px;">
                            <thead>
                                <tr>
                                    <th style="text-align:left">Cliente / Vendedor</th>
                                    <th style="text-align:right">kWh Comp.</th>
                                    <th style="text-align:right">Receita Líquida</th>
                                    <th style="text-align:right">Custo Usineiro</th>
                                    <th style="text-align:right">Rec. Vendedor</th>
                                    <th style="text-align:right">Desc. Cliente</th>
                                    <th style="text-align:right">💰 Lucro</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${profitRows}
                                <tr style="border-top: 2px solid var(--panel-border); background: rgba(255,255,255,0.04);">
                                    <td><strong>TOTAL GERAL</strong></td>
                                    <td style="text-align:right"><strong>${totalKwhClosed.toLocaleString('pt-BR')} kWh</strong></td>
                                    <td style="text-align:right; color:#10b981"><strong>${formatCurrency(totalReceitaBruta)}</strong></td>
                                    <td style="text-align:right; color:#f59e0b"><strong>${formatCurrency(totalCustoUsineiro)}</strong></td>
                                    <td style="text-align:right; color:#a78bfa"><strong>${formatCurrency(totalCustoVendedor)}</strong></td>
                                    <td style="text-align:right; color:#64748b"><strong>${formatCurrency(totalDescontoCliente)}</strong></td>
                                    <td style="text-align:right; font-size:1rem; color:${totalLucro >= 0 ? '#10b981' : '#ef4444'}"><strong>${formatCurrency(totalLucro)}</strong></td>
                                </tr>
                            </tbody>
                        </table>
                        ` : `<div style="text-align:center; padding:3rem; color:var(--text-muted);"><div style="font-size:2.5rem; margin-bottom:0.8rem;">📊</div><p>Nenhum contrato fechado ainda para analisar o lucro.</p></div>`}
                    </div>
                </div>

                <div style="margin-top: 1.5rem; padding: 1rem 1.5rem; background: rgba(59,130,246,0.05); border: 1px solid rgba(59,130,246,0.15); border-radius: 12px;">
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0; line-height: 1.7;">
                        <strong style="color: var(--accent-primary);">&#x2139;&#xFE0F; Como calculamos:</strong>
                        <strong>Receita L&iacute;quida</strong> = kWh compens&aacute;vel &times; pre&ccedil;o kWh &times; (1 &minus; desconto%) &mdash; o que cobramos do cliente ap&oacute;s o desconto &nbsp;&middot;&nbsp;
                        <strong>Custo Usineiro</strong> = 55% do pre&ccedil;o <em>cheio</em> do kWh (independente do desconto dado) &nbsp;&middot;&nbsp;
                        <strong>Recorr&ecirc;ncia Vendedor</strong> = 5% da fatura original do cliente &nbsp;&middot;&nbsp;
                        <strong>Lucro L&iacute;quido</strong> = Receita L&iacute;quida &minus; Custo Usineiro &minus; Rec. Vendedor &nbsp;&middot;&nbsp;
                        Com desconto de 20%: margem bruta ~<strong>25%</strong>. Com desconto de 25%: margem bruta ~<strong>20%</strong>.
                    </p>
                </div>

            </div>
        </div>
    </div>`;
};

// ---- POLLING DE WEBHOOK AUTENTIQUE ----
// Verifica a cada 60s se algum contrato foi assinado via webhook
async function pollWebhookEvents() {
    if (!currentUser) return;
    try {
        const res = await fetch('/api/webhook-events');
        const data = await res.json();
        if (data.ok && data.events && data.events.length > 0) {
            for (const evt of data.events) {
                const docId = evt.documentId;
                // Busca o cliente com esse autentiqueDocId
                const allClients = await getClientsData();
                const client = allClients.find(c => c.autentiqueDocId === docId);
                if (client && evt.event === 'document_signed') {
                    await db.saveClient({ id: client.id, contractStatus: 'Assinado', contractSignedAt: new Date().toISOString() });
                    invalidateCaches();
                    console.log(`[Webhook] Contrato de ${client.name} marcado como Assinado.`);
                }
            }
        }
    } catch(e) {
        // Silencioso — não interrompe o usuário
    }
}
setInterval(pollWebhookEvents, 60000);

// Start App
if(currentUser) navigate('dashboard');
else navigate('login');
async function testarEnvio() {
  const response = await fetch("/api/enviar-contrato", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      nome: "João",
      emailCliente: "cliente@email.com",
      emailEmpresa: "empresa@email.com"
    }),
  });

  const data = await response.json();
  console.log(data);
}
