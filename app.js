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
        app.innerHTML = '<div style="text-align:center; padding: 3rem; font-size: 1.2rem; color: var(--text-main);">Carregando Clientes...</div>';
        app.innerHTML = await ViewClients();
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
    const isAdmin = currentUser && (currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com');
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
    const isAdmin = currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com';
    const allClients = await db.getClients();
    const users = isAdmin ? await db.getUsers() : [];
    
    const clients = isAdmin ? allClients : allClients.filter(c => c.sellerId === currentUser.id);
    const activeClients = clients.filter(c => c.status !== 'Perdida' && c.status !== 'Desativado');
    const total = activeClients.length;
    const converted = clients.filter(c => c.status === 'Fechado' || c.status === 'Convertido').length;

    let adminUsersTable = '';
    if(isAdmin) {
        const userRows = users.map(u => {
            const isAdminAcc = u.email === 'vinicius@coopsol.com' || u.email === 'luisvalgas@coopsol.com';
            const isActive = (u.status || 'Ativo') !== 'Negado';
            
            let actionBtn = '';
            if(!isAdminAcc) {
                actionBtn = `
                <div style="display:flex; gap:0.5rem;">
                    ${isActive ? `<button class="btn btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);" onclick="toggleUserStatus('${u.id}', 'Negado')">Bloquear</button>` 
                               : `<button class="btn btn-primary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="toggleUserStatus('${u.id}', 'Ativo')">Ativar</button>`}
                    <button class="btn btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);" onclick="handleDeleteUser('${u.id}', '${u.name}')">Excluir</button>
                </div>`;
            } else {
                actionBtn = `<span style="font-size: 0.8rem; color: var(--text-muted);">Admin</span>`;
            }

            return `
            <tr>
                <td><strong>${u.name}</strong></td>
                <td>${u.email}</td>
                <td><span class="status-badge ${!isActive ? 'status-perdida' : 'status-fechado'}">${u.status || 'Ativo'}</span></td>
                <td>${actionBtn}</td>
            </tr>
            `;
        }).join('');
        
        adminUsersTable = `
            <div class="table-container glass" style="margin-top: 2rem;">
                <h3>Vendedores Registrados (Visão Admin)</h3>
                <table class="client-list">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>E-mail</th>
                            <th>Status de Acesso</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>${userRows || '<tr><td colspan="4" style="text-align:center;">Nenhum usuário</td></tr>'}</tbody>
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
    const isAdmin = currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com';
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

const ViewClients = async () => {
    const isAdmin = currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com';
    const allClients = await db.getClients();
    const users = isAdmin ? await db.getUsers() : [];

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

    const tableRows = filtered.map(c => {
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

    const sellerOptions = users.map(u => `<option value="${u.id}" ${sellerId === String(u.id) ? 'selected' : ''}>${u.name}</option>`).join('');

    return `
    <div class="app-layout">
        ${Sidebar('clients')}
        <div class="main-content">
            <div class="header">
                <h2>Gestão de Clientes</h2>
                <button class="btn btn-primary" onclick="navigate('simulation')">+ Novo Contrato</button>
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
                            <option value="Lead" ${status === 'Lead' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Lead</option>
                            <option value="Em Negociação" ${status === 'Em Negociação' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Em Negociação</option>
                            <option value="Fechado" ${status === 'Fechado' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Fechado</option>
                            <option value="Convertido" ${status === 'Convertido' ? 'selected' : ''} style="background: var(--bg-dark); color: var(--text-main);">Convertido</option>
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
                    <tbody>${tableRows || '<tr><td colspan="6" style="text-align:center; padding: 2rem;">Nenhum cliente encontrado com os filtros aplicados.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    </div>`;
};

// ViewGallery removed

const ViewCommissions = async () => {
    const isAdmin = currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com';
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
    const isAdmin = currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com';
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
                <button type="submit" class="btn btn-outline" style="width: 100%; margin-top: 1rem; background: rgba(16, 185, 129, 0.1); color: white; border-color: var(--accent-green);">Calcular Economia</button>
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

let currentSimData = null;

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
    let discount = kwh > 500 ? 25 : 20;
    
    const coopBill = energiaCompensavel * (1 - (discount / 100)) * kwhPrice;
    const utilityBill = (taxaDisp * kwhPrice) + publicLight;
    const newBill = Math.max(0, coopBill + utilityBill);
    const savings = Math.max(0, value - newBill);
    
    currentSimData = { 
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
        billUrl: currentSimData ? currentSimData.billUrl : null,
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
                <small style="color: var(--text-muted); font-size: 0.8rem; margin-top: 0.2rem;">*Sugerido pelo sistema: ${discount}%</small>
            </div>

            <div class="result-actions">
                <button class="btn btn-outline" onclick="saveClient('Em negociação')">Salvar Em negociação</button>
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
                <button class="btn btn-outline" onclick="saveClient('Em negociação')">Salvar Em negociação</button>
            </div>
        `;
    }
};

window.saveClient = async (status) => {
    if(!currentSimData) return;
    
    let clientId = currentSimData.id ? currentSimData.id : Date.now().toString();

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
    const isAdmin = currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com';
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
                    <div style="margin-top: 0.3rem;"><span class="status-badge" style="background: rgba(217, 119, 6, 0.1); color: #d97706; border: 1px solid rgba(217, 119, 6, 0.2);">${client.contractStatus || 'Não informado'}</span></div>
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
                <button class="btn btn-primary" style="flex: 1;" onclick="navigate('simulation', client)">✏️ Editar / Atualizar Dados</button>
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
            navigate('dashboard');
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
            navigate('dashboard');
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

window.closeContract = async () => {
    if (!currentSimData) return;
    
    // Logo em Base64
    const logoBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAATwAAACfCAMAAABTJJXAAAABklBMVEX///8AMz//4wD/5QD/4QD/5wD/6QD/6wD/7QD/7wD/3wD/4gAALDkAFykAIjHf5ucADiMAtEFcbXQAs04As1YAs1oAKDb3+voAs2g6VV4AsnMAHi4AtEgAtTI5tgAAsngAtDoAs2AhthAAsYkAtSQAs24/tgA7OzsAsnYAsn4XthQAsZIAtSFMtwAAsZRMTEwAsYQtLS3V1dWUlJRbW1vh4eEArZhwhoy6urpCQkLIyMhra2vW1tbu7u4AsYy+x8qlpaX/+cOP2M6bqq5ke4F0dHSDg4Ourq7//vNy0Jz/4zKLm6AXPkmtubyMjIz/95X/9YH/+KzS8efq+e3/++D/+NH/514/vKwsTldKYGh8jpQiIiIUFBT/9Fj/8zH/9XPL7dyX27av4b/X8uJVx5A+wGtayoG04sqF1Zx/062z489cyJ9ExWCp4bPB68i359d5z6+S2MFMwXhIwUNoyFzf8dfH6LlVwpKR1YVyxEFWwqOO2aaBzmqY0HN60oT/7oeu2pBtzL16xkd1zXCq3qCh3dZR/28GAAAWN0lEQVR4nO2di38SxxbHQ7WtrcuiWHeKGE01ikYTDIHwXBcDeTRAYoJGwGoxMWq0GrW39XHbanrr/31nZnfntbuwCbt5VH6fT1thZ+fx3TNzzpwd7MBAX3311Vdf7nRrafHmvfvfmLp/7+fFpdt73akDoLmlm5Qar/s3l27tdff2sW4v3nMARwHemNvrXu5H3Vp0MjlBN/szWNCNbjbH2d9S3/yI5pbuHdkGu2++OXJ/sY9P19L97aHD+L750MeHJuyRnenrpb3u+l7r1s87RId0//N2HUtHvu4B3pEjNz/fuXvr3te96rM1vhs9o0Na3Oth7IkWv/IE3lf3dmvq1uvL7Xb78YMHGz8yevBg9XG7vVYHu9QLrJ+9YQfp3fd3ywsgsgcbD19f+P6HH06e/I7ohKHTSPC/360/egI51n3tDNbcva88lE8LX739eOPhqe8hNE4nsUSIkODx40NDx0+fWH/you2nHc7d95LdV1/d8Lh/AGG78D0jN/BOY4CQINQvf62uedwpQ3NffuktPC/ptR8/u3SBA7cdeIgeBjg4ODi0/tx7gJCd5/KE3vLTjcsXiHqDhzQ4PDz41wtPp7Af7Hqnt/z42akLp6A8gWfQQ/Y3fPWX5955kflDvtDrwWssv3p2ishDy8PwEL6RX557Y3/3/GH35Zc7i/fqT59dOnXqEpKH8I6z8HR+6y96Z3fzkF+a33ZfwObLy6cuncXyFt6QAA+ufldHhp/0OH1vfOEbvEM3t9WT5VdvzhrgdgUe1MjI/3oxv1s+sjv0hesMHzS5axDY5ct+wROnrQ4PWt/IrzvHN/+FnzrkaqMGnr6/jMAhuYUnkLPZprmxvOGrVyG+wR06j8WjfrI7enilKzjoWC8z6g5PZwb/gL94/fq1/uXJkyd4ubO8qxjf8O87YHfLP3ZHjx6dX7nR2fLgZD1/mZcjPEzr0sOHGxur7fba2nK9DpBQLUj1+tpau7364MeHr9e/I+DcWB6Ct6PJO3/4qB86fPjw0ZXF23qoAuznBDS599cuX0PqDO8CYvZm41Ub8nI3qvpae/XHR+snEDS38M6N/Oe3rhX/9vsL2oWlw77o6MoHAxxE9GnZBl598+X1a0QO8CC3S5chtTW7GroL1NdWf1w/PTTkYtpCeFBvO7fz27uLZ86d+cfAN+cHOQjOnKv1zakp68CRyZ2/xsoCD9nc2TfPXrV7z2jW2/99dHpwaKir5SFd7LT01UdHRy+eOXPuqo5v7vbN+W+/9QgarGh+ZemWuasAy1N3tj5Zxm6YXCd4ly6dffPy1bKHOcz62pP1oUEX8M6c+8O52T8NeOdGrv6l52bmbn9YgePuiSC8/dv5lQ83GHCf7kze+ST2A5nc9WvnsWzhIaO7huzNO24U4PNHEFw3eGfOOBvfKIEHRVILczd0gDsUx00HN3lnSgRQb29dOU9lhQcDvWcvn/r55qG++mhwuBu8M2f+dOgCA+8qDK4H14nzmLu9eHN+uwTh+rZ0e45u/+twqk7akINT+P3185xEdtfev9qZW9ie6s/Xrw53gXfmnb3bfcfCGx6GFbC51bm5W0sfPqy4srYPPDZkcFsIHJytAoP65taV67rs4EFwb/w1OEFrT3Tzc4J3Ecp26n4U4GENnXjEZffn5uZuLy1Ciivz8/MssPmVlQ8fFhE0LtdEuE1Oih4CrXImOTt4yOA2HeJA/wSenx4Z7gjv4ke7+95dFOHhMGjo9InX/23bpffniOx6sbw5dWfM0OTWJk9h+RMLjoeHyF3fVYPj9eKXkU7wRi/+YXfXR8jOCk/fx5w4+frH1faaC18Hlpc3t96PjV2BwuTuTC1zBZi5aoGHIpX3r3x9F+hCBj4HeKMX/7bN5P7z6zk7eGgrjXMSJ3/4/sLDjQePN9vLy4AxDbh9hMg2X22Z9nTF0NiUaHJTY1f0q1Z4165debm5LPZpT/TiOPKaDvBGR9/Z58F/e2sPD5E7efIHkrWAG3GcDj9rpovwOgUJEHbXx6xz9c4VKtHq0Aq3G1xc6vnwiDM8J3qQ35NBxM8J3vc6Oh2eyc5EZ8DrBo6DB+95tU8MjtOTEWd4o38731df/WsImt9gJ3inTukvFAR456+//ySQgB537IpFBrr3T3cjhtuR1n4ZcYQ3aus1iMCL54+Oo03fcRfwdHyQhDj1MLgx7Dks5OBE3YWDNr3o+ciIE7xRMd6rW4wAtFefP1rXs6+YH1nxMD1z4sIF66kVBALHiJLD6+E+nKhW1X91hPdOLAs2bTNsA2Ct/fjx6sbGw4cPX+vAzr559mzjJUS2uWwXkKG8yZgg0wFDbvt1otroiRO8UZuN2vKUGF1sV9DgJlFgbCE3dsC46Xqhs7PC+2hXGnza2vq0o/he34wJ2MbwinfnIHLTBaeue3gDiN+dO1v2M9jhBrA5pW9ix9A/rCbhDuOgcjP0v5HtwBtAVrSFEkiQYKeBAwCtbcrc+xPpxjeJzG2f+1N3ejuyPXhIOHcJEW5NfUIQWS1DZhCaSE0HN4ntds929j7orQ287q9zmZwS5miHa5K9vgUn6b/C2nj9Y4XncpTQzuytjCLd2praPOhLW0d9PCfA+3Nbt+upk09wukJt4X/D2QztDOx6ynIv9Mc5Ht6/cHr5qF/PsfB2coDlM9bcfzC9Prud6Z9R4zXGH92PrnyGAqVys9kMpzX7y3O/f3z79u0//eXOVo2oIkEpwdJe9+TgKXQsoEsK+98YCGGp/5ZQJRTcHXghrdWswlaQAoFqs6KFfG1vV7Qr8EKVhgJXhwCVpMhStZXwr8ld0S7AKzRlDhyREm04uKkDIt/hqeGgLTm90WDZn1Z3R37Dq8mKIzqkYM2XZndHPsOrBDuiCwTkgxwh+QuvEu3CLhA8yE7DV3gli91JRqxCPke8b3X35Cc8TebAKUqg0SyXy81GVZINgMED7W59hAcarJuVYVinkla1chXxkw+0s/UTXoUxPEkqCXsyoDWVYPNgb9T8gxdi7E6JqDYlErWDzc5HeC0a4CkH3MKc5Bs8tUrnbHUbZwnUlIaUCnW+Rw0VULFCyM6kLXWisimHkiCklaC0gkOyB4T0Htkkg3yDV6MhnmuXqmrpSCAYRQoqjXLNabiFVrgq43LBaLVZSYijUlO1UqtV0D+EKnBxRUUDYesyAbRyQ47KUNGgFLG2qJbKDcXoUSCSFq77Bq9MZq3i0qWGWlU29SIpUalsk7cCtQiXoYHlmtweL1WuRqOyIgfQzaASMMOigBStCptBrcm1KEUDLRZPoazIEtejKnfdL3jMrA0WXN1RCvBhIeautERjKTSjlkSDJDeZNszdtNyCw2tylUrRNFtXRbZUJUdIg6Blsy+Xq8x+0i94BTJr3W0iQNiKTh8Mb3wl++yWJFGbYhoOVcXhy8ww03abx2DOuBpq2PeI4e8XvBJpWam4KA6a9j2FtzdYeiWnYgGZ0GuaeKtaw0paJmOv2NYVNZfKqlMmjUb2fsFLk0fuauvvYHeYHp1IAzXnYoGo6ZYqpGnb8UcNygX7XFlVX9RUR3YMf7/gkccfUFzEKVz2RVIUbm4qxFZC3BgkRZjCxlpes8xGiStn4AlzTsdMdqOFEl9l0aKW2CrMJKRP8ADxF26WvBAzXCUaSVfS0KHSr2TTppgRScFquVIJBxjvYXp1jYenBKuRRpAxWZ1PiNYlB2BVlXI1CL+S9EWCfQCy3GxVyg02IS6pfsJTSUtSuntpBkq0pfdeZYxRalqoyBF9MQBag95ruPUQmwiTZFwhKLGOVeXwRM1FuZBWjum+lMlpSIqxKw+VmeZbfEsewyMDcOEvyLtj2AsaTxeosRimR5cCuupDN03oSWV+SAHW3TBTHmevyaKstGhPgFGakpWq1F8x5hgFXEvewksFuZ52Fl3hZTaI1egDwFRopsE0RSzGSvQhAfos2E11IcjdTpa8oE0gTh8Td5X6Z31UPsGjM0zu/oaH+ha+D3RJx2s87foxbry0LcOREnhShHVWNACACxtodoBHH5PMzRv6nPSVfB/Ao9NM5qMaais4DCHDlYT9nniBwKtyW1HaDoJMbrLpIJ2fQT5UoGHmMTCwL+CR4M3imAOkkgq74YsKiQY6JAl/JsdvIvzQSeiGgh8mUrHkH8psQVbUJHEf9gE8unSLjpmkBFHnUnR2CsVC1B4wByd4ZG1Fix4ziSWxi8Qqo45X8KLnOzxL+xY1HCcQmT7IJumHhlBMbfA26QSPdqoBuM1KtMElq6iNW9ZD/kH7BC9BLa+rt6W+Vky/0Frg6lVxNFBx/XKCx8QwIe4tAYwGo8zpTnrpmNhSiVti9kGcRyML8Tmr7GjpQ7c8jjI3mRzh0RgG7SPS/N4WbkRMw6eOqiq2RI0XXfILHmmEjUHti9KuWoIGdrRpnhArwkGPLJzg0epQ6iQUELb+knloK8GuFryYYHHAP3i0S81uRV3CCzvHFgSeHqs4wqOZHrRAaJYUjRRNoztqbuChGe1XYoCG/d3e/lB4DUvJbcNLs3dZ4NFgB6+uNUmwPVh3U+0IL0X4+wiPCaOCXd5v7aLlEUZGxjMRsaT00Yauk+WR5chPeC37/aqN3MIru4CnL7CO8OgWw/TrtYj4GiNaoV6h07SVB/yDR8OorhW78bYS422tDqPMO+LuDkNJmV8BLSwJKWU15extczSxMuAfvBST/Ooyb2lUI8Z5IdYoK3Y5JF1hd6EKF/kwrVSqrOuI1uiORdzLMFvJxoB/8BiPIXeJ9Bz3rMz8gb6Exqei/6ZtRTsGyRobc7NSS8xbNiVNQwXLDoPbMPr30puJQaXOpkfsxmJS3GaUbjcUoRjdEeiDdYJXcsxADAD6GlJqggh5GOLjpH1FFuEbPCZn3uXIgLNJNdjsBoNImN41IWXgBM8xp4VEPXYDOD5OJrODbNw3eOzRxmjH/S3FLPGzhK5RfD5P3PGVWQMdcIQHOu63GacPmLfDTl3F+Vj/jpix75Qd6Gn62x46KP5B0/Q8XuBp9MO/zaQmaex6HeDR6iyeietFVaWvT4ScEE3PYz/sHzzmtArsRNl6QKnWiMpRRIWeCQqwo1JptIMtKkEPIXCQ6e1Get4enkoTeHZvQ0GQ3sXuj9gymnAMYpeO1QaUQIWdk0BL49NLEuocfdMjNahvYV/s4OdP13HOIGgzJhSahmeehcX9q80wm/WnK2+YrZNdrxN0OLpnAg4Jfw/EH+gOyEqjpWmFQkHTKmF0NJ5ioEcbpKrp3zTmvIOxPS4xr/7M01Nqmj4iEynz9qxcsKkOLwJqQ5HkJvGm1KgQWuY9pUJOGtVoGsZ0bXQb5flvcQpC2kJSZFlR4L/YLRE2PebFrVyt1LRapcGUMXvGPg1FKtc0rRRWmIjIzDDT2lB15VKt1mKr05OpGDq83ILVaKUI85IY7T6YWSPJkZKm1VpsJG2+vmOsuQxrsTtOuGPVuv14KmDEHezJEISY+5kkTbtzBylQMW5jesychQw8PHhZ+NUlmmJkh4+rYdHi5Quwhopq4I7qkXfu7LlrVMjTn+RYfwJkEZ5rQExMspLp82x1+DkWOTUhwLNtUMwjM63p296EJdlHxTxNYXzHyJ7ZC9WsZy8F6S+8QvZnFvFo2Cjf+ShalK7sHeEZZxPDDvDIX7VgPWtlSmLCUeEAoKuziO4VanT87Z5kHva2JMXNAjK/Qyo7VMew6wjPPNfp8HNMar6Oz11hM2cJvhq3x69dqxRwtD6FOTSr2pw1Ri8FxTW4pNjYjMK9FGLcj+U1BYkQyzbNSZzTLNidq5XkMBex8gtT13cO2xaoRSQrP+gXAmHOqmoN4QC1xJ2eNhVCR9T5mhTezZEguZloytzCz/4sX7M2FxF2HpbnrsiWH/bX2HRg0Ntpawy4Fq4G5CgKVBQcrEjVSEuzBJZauSoZheSoUg1r9q8/QpVIQJbNqgKRimCddIcBqwwbRVFBYeBauiohT4z+WhlZfJRYoNZkeiRVyza/KAnBIMZsodubwh0rBAOhVhoJBnKOv+8JGYVKmuWnKXyxWsWsynKR356pWkmv0C4Ig82lw81mOV3KOf5iRr/foQJcxGzB623GXsgxDd9Xd/Xh9aA+vB7Uh9eD+vB6UB9eD+rD60F9eD2oD68H9eH1oD68HtSH14P68HqQmZ9UPE9Nfgaq6X/nyjFLFrovNwppmpb4N2TX+uqrr+5SMzv30DlPX3mDTM72ezVTLGZ2Y0naPorceBcCAPbd/m+KAfGFbTbWuSexmA0isDAez+fjd+3BeiAwSzrw03aNIRHrfEciG88nxydsm03afr1TzSTjGZtvsxib0+uq3pUYN+1NzW3X8rrAA8k8rDFlW8ZbeGo2Mz1t+TYxLgJNZViQai5D+wb/lGA+chdBaiCVo98XCLFiNlEgRfSv9P8WjGbURMbu0YFcTmXgqTlroVQsI9ySIS/KvYWXiakZ6xIyEee7BPKxZJz2KROLJ2PTRhHw02w+Ho8VycVsPDk+Qz4UYzHcdTADb8omjaZmsvFsXCdpTtvZu6jC1E866yIsHc9a5kQhnk3Gp+Nmhydi8fi4uIqlskX2I+pPLG921lN4+RlofEXx2+m8UCqeAqBoPvBcbBaAAll64RgBmDAvFmITKkjEZs2i+VRKh1RMAKAmDSsHs1nzr7g0l3/dYIpZ/dtMRgVgQXiGcL3Pq0BdyBptFWM5AHKWWTIdm2DmxXgRgBRp10t4qRh80NNJ4VuQ52dySu9f3Gh4BqOdHTdGhr8G5sUFXNmMUWUuxnu9ibjxh0zWnMHEd+JGk6wdWdxqDluxOW2BXng6zhcagHRj02a7eosZcouH8Ipo7uTGxWP7wjJoTGwdmtmBgsklXsS3GMaan06lUurEuP5JH62uRHEBeiezSis89DRU0pXU7MRMXvQMRWyKJryUPq0z4xaPk5og64huc+p4ju27JwLJ5OzsbDEr1jid5/qT0Y3MMCc1bsAzPIEOzySbj8egshbLg2tefmEi3wGeCuftrDFr4YxMLkxMW+Ghu0x4Rg8y4zaORc0bEVgcL7+qMbe9hJfI5pGSceHZFbNcr3OC5S3oXXewPBXLuJPAy+Dud5q2aN6aY0vhMM0ybYtZd5aH782ZlQ74Y3kLSdxuIiYEw6kY14a+5gHTQGfwXUUzuMbwVLLmcQ+CwpvA417oBA96fnPW6iuJJQ7QieRMg0xiq7KseXplxr0TuCEf1jxVNxqzF4wmYgspVS3MGNenswlVXTD7nIAOVc1libdNwoszWeJtZ+Cds8TbMpanqhNxc6C5WE7wtijmnDEvQ8tT1UzcEg0nkyk1lzS/no3BOmdFb5uYzqlqIm4sHKnYDPpkDjA57dX/lCx31/T5d8VlI5OMZbOxvGGRcMHKxuLEPDNxeG3B7ER8OgkvkhHAscGPBrzEXdMB4CpmyBSDkaOBm9meTd8tmn8swubzuay4PUzBypmvi1nYkaJYZhp13QxD9f7MkE+xmEe2B1TxD+y1QoHdUyRSzBMDKeYaNN9Ugb9Iy3JVqOxnsn9ifo3Fli7A61YrASnua1Cw+xvRue4Jn9T9lYA1535fO1AfXg9KznYv01dfffXlp/4P/YKfXgCEKugAAAAASUVORK5CYII=';

    const hoje = new Date();
    const dataFormatada = hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    // Lógica para o texto do Cooperado (PF ou PJ)
    const pjText = currentSimData.repClass === "Pessoa Jurídica" 
        ? `QUALIFICAÇÃO – PESSOA JURÍDICA ${currentSimData.name}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${currentSimData.documentId}, com sede à ${currentSimData.address}, neste ato representada por seu(s) representante(s) legal(is), ${currentSimData.repName || '[NOME COMPLETO DO REPRESENTANTE]'}, ${currentSimData.repNacionality || '[nacionalidade]'}, ${currentSimData.repCivil || '[estado civil]'}, ${currentSimData.repJob || '[profissão]'}, inscrito no CPF nº ${currentSimData.repCpf || '[CPF]'}, residente e domiciliado à ${currentSimData.repAddress || '[endereço completo do representante]'}, doravante denominada simplesmente "COOPERADO".`
        : `${currentSimData.name}, ${currentSimData.repNacionality || '[nacionalidade]'}, ${currentSimData.repCivil || '[estado civil]'}, ${currentSimData.repJob || '[profissão]'}, inscrito no CPF nº ${currentSimData.documentId}, residente e domiciliado à ${currentSimData.repAddress || currentSimData.address}, doravante denominado simplesmente "COOPERADO".`;

    const docDefinition = {
        pageSize: 'A4',
        pageMargins: [ 40, 100, 40, 40 ],
        header: function(currentPage, pageCount, pageSize) {
            return {
                image: logoBase64,
                width: 150,
                alignment: 'center',
                margin: [0, 15, 0, 0]
            };
        },
        content: [
            { text: "CONTRATO DE CESSÃO DO BENEFÍCIO ECONÔMICO DE CRÉDITOS DE ENERGIA ELÉTRICA", style: 'header', margin: [0, 10, 0, 5] },
            { text: "NO ÂMBITO DO SISTEMA DE COMPENSAÇÃO DE ENERGIA ELÉTRICA (SCEE)", style: 'subheader', margin: [0, 0, 0, 20] },
            
            { text: "Pelo presente instrumento particular, as partes abaixo qualificadas:", margin: [0, 10, 0, 10] },
            
            { text: "I – COOPERATIVA (ADMINISTRADORA E GESTORA OPERACIONAL)", style: 'boldText' },
            { text: "COOPSOL – COOPERATIVA DE GERAÇÃO DISTRIBUÍDA DE ENERGIA, pessoa jurídica de direito privado, constituída sob a forma de cooperativa, inscrita no CNPJ nº 33.923.055/0001-22, com sede à Rua Professora Arlinda Andrade, 667, Sagrada Família, Abaeté, CEP: 35.620-000, neste ato representada na forma de seu Estatuto Social, doravante denominada simplesmente \"COOPERATIVA\".", style: 'paragraph' },
            
            { text: "II – COOPERADO (UNIDADE CONSUMIDORA BENEFICIÁRIA)", style: 'boldText' },
            { text: pjText, style: 'paragraph', margin: [0, 0, 0, 10] },
            
            { text: "CLÁUSULA PRIMEIRA – DO OBJETO", style: 'boldText' },
            { text: "1.1. O presente contrato tem por objeto a cessão, pela COOPERATIVA ao COOPERADO, do benefício econômico decorrente da compensação de créditos de energia elétrica, no âmbito do Sistema de Compensação de Energia Elétrica – SCEE.", style: 'paragraph' },
            { text: "1.2. Os créditos de energia elétrica são oriundos de ativos de geração distribuída vinculados à COOPERATIVA e/ou aos seus cooperados investidores, sendo sua gestão, alocação e compensação realizadas exclusivamente pela COOPERATIVA.", style: 'paragraph' },
            { text: "1.3. As partes reconhecem que o presente instrumento não configura compra e venda de energia elétrica, tratando-se exclusivamente de cessão de benefício econômico no âmbito de ato cooperativo.", style: 'paragraph' },
            
            { text: "CLÁUSULA SEGUNDA – DA TITULARIDADE DOS ATIVOS", style: 'boldText' },
            { text: "2.1. Os ativos de geração e as cotas-partes vinculadas pertencem à COOPERATIVA e/ou aos seus cooperados investidores, não sendo objeto de transferência ao COOPERADO.", style: 'paragraph' },
            { text: "2.2. O COOPERADO fará jus exclusivamente ao benefício econômico da compensação de créditos, não adquirindo qualquer direito de propriedade, participação societária ou titularidade sobre os ativos.", style: 'paragraph' },
            
            { text: "CLÁUSULA TERCEIRA – DO PRAZO DE VIGÊNCIA", style: 'boldText' },
            { text: "3.1. O presente contrato terá prazo de vigência de 12 (doze) meses, contados a partir da data de sua assinatura.", style: 'paragraph' },
            { text: "3.2. O contrato será renovado automaticamente por iguais períodos, salvo manifestação contrária com antecedência mínima de 120 (cento e vinte) dias.", style: 'paragraph' },

            { text: "CLÁUSULA QUARTA – DO BENEFÍCIO ECONÔMICO", style: 'boldText' },
            { text: `4.1. O COOPERADO fará jus a um desconto de até ${currentSimData.discountPercent}% sobre a tarifa de energia elétrica da distribuidora, incidente sobre a parcela compensável.`, style: 'paragraph' },
            { text: "4.2. O desconto não constitui garantia mínima, estando condicionado à geração efetiva, regras regulatórias, perfil de consumo e fatores tarifários.", style: 'paragraph' },

            { text: "CLÁUSULA QUINTA – DO PREÇO E FORMA DE PAGAMENTO", style: 'boldText' },
            { text: "5.1. O COOPERADO realizará o pagamento diretamente à COOPERATIVA, conforme o volume de energia efetivamente compensado.", style: 'paragraph' },
            { text: "5.2. A COOPERATIVA será responsável por:\na) emissão de boletos, PIX ou outros meios de cobrança;\nb) emissão de documentos fiscais, quando aplicável;\nc) gestão financeira e administrativa;\nd) controle e cobrança de inadimplência.", style: 'paragraph' },
            { text: "5.3. Em caso de atraso, incidirão:\na) multa de 2%;\nb) juros de 1% ao mês;\nc) correção monetária pelo IGP-M.", style: 'paragraph' },

            { text: "CLÁUSULA SEXTA – DAS OBRIGAÇÕES DA COOPERATIVA", style: 'boldText' },
            { text: "6.1. Compete à COOPERATIVA:\na) gerir os ativos de geração;\nb) realizar a alocação dos créditos;\nc) garantir a operacionalização junto à distribuidora;\nd) manter conformidade regulatória;\ne) prestar informações ao COOPERADO;\nf) realizar faturamento e cobrança.", style: 'paragraph' },

            { text: "CLÁUSULA SÉTIMA – DAS OBRIGAÇÕES DO COOPERADO", style: 'boldText' },
            { text: "7.1. Compete ao COOPERADO:\na) manter a unidade consumidora regular;\nb) efetuar os pagamentos nos prazos;\nc) fornecer informações necessárias;\nd) não interferir na operação do SCEE.", style: 'paragraph' },

            { text: "CLÁUSULA OITAVA – DA SUSPENSÃO DO BENEFÍCIO", style: 'boldText' },
            { text: "8.1. Em caso de inadimplência superior a 30 dias, a COOPERATIVA poderá suspender a alocação dos créditos, independentemente de aviso judicial.", style: 'paragraph' },

            { text: "CLÁUSULA NONA – DA RESCISÃO", style: 'boldText' },
            { text: "9.1. O contrato poderá ser rescindido por qualquer das partes mediante aviso prévio de 120 dias.", style: 'paragraph' },
            { text: "9.2. A rescisão antecipada injustificada implicará multa equivalente a 3 meses da média de compensação.", style: 'paragraph' },
            { text: "9.3. Alterações regulatórias que inviabilizem o contrato permitirão rescisão sem multa.", style: 'paragraph' },

            { text: "CLÁUSULA DÉCIMA – DA CONFORMIDADE LEGAL", style: 'boldText' },
            { text: "10.1. As partes declaram que o presente instrumento:\na) não configura comercialização de energia;\nb) atende à Lei 14.300/2022;\nc) caracteriza ato cooperativo;\nd) possui natureza privada.", style: 'paragraph' },

            { text: "CLÁUSULA DÉCIMA PRIMEIRA – DA FICHA DE MATRÍCULA", style: 'boldText' },
            { text: "11.1. A Ficha de Matrícula integra o presente contrato como Anexo I.", style: 'paragraph' },
            { text: "11.2. Contém dados operacionais, rateio e condições comerciais.", style: 'paragraph' },
            { text: "11.3. Poderá ser atualizada sem aditivo, desde que não altere condições essenciais.", style: 'paragraph' },

            { text: "CLÁUSULA DÉCIMA SEGUNDA – DO FORO", style: 'boldText' },
            { text: "Fica eleito o foro da Comarca de Belo Horizonte/MG.", style: 'paragraph' },

            { text: "ASSINATURAS", style: 'boldText', alignment: 'center', margin: [0, 30, 0, 10] },
            { text: `Belo Horizonte, ${dataFormatada}`, alignment: 'center', margin: [0, 0, 0, 30] },

            { text: "_______________________________________________________", alignment: 'center' },
            { text: "COOPERATIVA – COOPSOL", alignment: 'center' },
            { text: "CNPJ: 33.923.055/0001-22", alignment: 'center' },
            { text: "Assinatura: ______________________", alignment: 'center', margin: [0, 0, 0, 30] },

            { text: "_______________________________________________________", alignment: 'center' },
            { text: "COOPERADO", alignment: 'center' },
            { text: currentSimData.name, alignment: 'center' },
            { text: `${currentSimData.repClass === 'Pessoa Jurídica' ? 'CNPJ' : 'CPF'}: ${currentSimData.documentId}`, alignment: 'center' },
            { text: "Assinatura: ______________________", alignment: 'center', margin: [0, 0, 0, 40] },

            { text: "TESTEMUNHAS", style: 'boldText', alignment: 'center', margin: [0, 0, 0, 20] },
            { text: "1. Nome: __________________ CPF: __________________", alignment: 'center', margin: [0, 0, 0, 20] },
            { text: "2. Nome: __________________ CPF: __________________", alignment: 'center' },

            // ANEXO I
            { text: "ANEXO I – FICHA DE MATRÍCULA DO COOPERADO", style: 'header', pageBreak: 'before', margin: [0, 20, 0, 20] },
            
            { text: "1. IDENTIFICAÇÃO DA COOPERATIVA", style: 'boldText' },
            { text: "Razão Social: COOPSOL\nCNPJ: 33.923.055/0001-22", style: 'paragraph' },

            { text: "2. IDENTIFICAÇÃO DO COOPERADO", style: 'boldText' },
            { text: `Razão Social / Nome: ${currentSimData.name}\n${currentSimData.repClass === 'Pessoa Jurídica' ? 'CNPJ' : 'CPF'}: ${currentSimData.documentId}`, style: 'paragraph' },

            { text: "3. UNIDADES CONSUMIDORAS", style: 'boldText' },
            {
                table: {
                    headerRows: 1,
                    widths: ['auto', '*', 'auto', 'auto'],
                    body: [
                        [ {text: 'Nº UC / Instalação', bold: true}, {text: 'Endereço', bold: true}, {text: '% Rateio', bold: true}, {text: 'Consumo', bold: true} ],
                        [ currentSimData.ucNumber || 'N/A', currentSimData.address, '100%', `${currentSimData.kwh} kWh` ]
                    ]
                },
                margin: [0, 0, 0, 15]
            },

            { text: "4. CONDIÇÕES COMERCIAIS", style: 'boldText' },
            { text: `• Desconto: ${currentSimData.discountPercent} %\n• Forma de pagamento: Boleto / PIX\n• Responsável pela cobrança: COOPERATIVA\n• Periodicidade: Mensal\n• Prazo: 12 meses com renovação automática`, style: 'paragraph' },

            { text: "5. DECLARAÇÕES", style: 'boldText' },
            { text: "✔ Não há compra de energia\n✔ Operação via SCEE\n✔ Aceite integral do contrato", style: 'paragraph' },

            { text: "6. ASSINATURAS", style: 'boldText', margin: [0, 20, 0, 10] },
            { text: "COOPERATIVA: ___________________________\n\nCOOPERADO: ___________________________", style: 'paragraph', margin: [0, 0, 0, 30] }
        ],
        styles: {
            header: { fontSize: 13, bold: true, alignment: 'center', margin: [0, 0, 0, 5] },
            subheader: { fontSize: 11, bold: true, alignment: 'center', margin: [0, 0, 0, 20] },
            boldText: { fontSize: 10, bold: true, margin: [0, 10, 0, 5] },
            paragraph: { fontSize: 10, alignment: 'justify', margin: [0, 0, 0, 5] }
        }
    };

    pdfMake.createPdf(docDefinition).download(`Contrato_CoopSol_${currentSimData.name.replace(/\s+/g, '')}.pdf`);
    
    // Salva o cliente como Fechado após emitir
    await saveClient('Fechado');
    navigate('dashboard');
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

window.updateDashboardFilters = (search, status, sellerId) => {
    currentFilters = { search, status, sellerId };
    navigate('clients');
};

window.updateCommissionFilter = (vendedorId) => {
    commissionFilters.sellerId = vendedorId;
    navigate('commissions');
};

window.toggleAnalyticsUnit = () => {
    analyticsUnit = analyticsUnit === 'kWh' ? 'BRL' : 'kWh';
    navigate('analytics');
};

window.updateContractStatus = async (id, status) => {
    try {
        await db.saveClient({ id, contractStatus: status });
        alert('Status do contrato atualizado!');
    } catch(e) { alert('Erro ao atualizar status'); }
};

window.updateClientTemperature = async (id, temp) => {
    try {
        await db.saveClient({ id, temperature: temp });
        alert('Temperatura do lead atualizada!');
        navigate('clients');
    } catch(e) { alert('Erro ao atualizar temperatura'); }
};

window.updateClientSeller = async (id) => {
    const newSellerId = document.getElementById('update-seller-id').value;
    if(!newSellerId) return alert('Selecione um vendedor.');
    try {
        await db.saveClient({ id, sellerId: newSellerId });
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
        // ... (other fields if needed)
    };
    try {
        await db.saveClient(data);
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
    const negClients = clients.filter(c => c.status === 'Em Negociação' || c.status === 'Lead');
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

    // Dados por Vendedor
    const sellerPerformance = users.map(u => {
        const userKwh = clients.filter(c => String(c.sellerId) === String(u.id) && (c.status === 'Fechado' || c.status === 'Convertido'))
                              .reduce((acc, c) => acc + (parseFloat(c.kwh) || 0), 0);
        return { name: u.name, value: analyticsUnit === 'kWh' ? userKwh : userKwh * factor };
    }).sort((a, b) => b.value - a.value).slice(0, 5);

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
                labels: ['Fechado', 'Negociando', 'Lead', 'Perdido'],
                datasets: [{
                    label: analyticsUnit,
                    data: [
                        analyticsUnit === 'kWh' ? totalKwhClosed : valClosed,
                        analyticsUnit === 'kWh' ? negClients.filter(c => c.status === 'Em Negociação').reduce((acc,c)=>acc+(parseFloat(c.kwh)||0),0) : negClients.filter(c => c.status === 'Em Negociação').reduce((acc,c)=>acc+(parseFloat(c.kwh)||0),0)*factor,
                        analyticsUnit === 'kWh' ? negClients.filter(c => c.status === 'Lead').reduce((acc,c)=>acc+(parseFloat(c.kwh)||0),0) : negClients.filter(c => c.status === 'Lead').reduce((acc,c)=>acc+(parseFloat(c.kwh)||0),0)*factor,
                        analyticsUnit === 'kWh' ? totalKwhLost : valLost
                    ],
                    backgroundColor: ['#10b981', '#f59e0b', '#3b82f6', '#94a3b8']
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
                datasets: [{
                    label: analyticsUnit,
                    data: sellerPerformance.map(s => s.value),
                    backgroundColor: '#8b5cf6'
                }]
            },
            options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
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
                <button class="btn btn-outline" onclick="toggleAnalyticsUnit()" style="display:flex; align-items:center; gap:0.5rem; border-color:var(--accent-primary); color:var(--accent-primary);">
                    🔄 Alternar para ${analyticsUnit === 'kWh' ? 'Reais (R$)' : 'Volume (kWh)'}
                </button>
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
        </div>
    </div>`;
};

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
