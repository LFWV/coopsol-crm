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
        await firestore.collection('clients').doc(String(client.id)).set(client);
    },
    deleteClient: async (id) => {
        await firestore.collection('clients').doc(String(id)).delete();
    },
    uploadBillFile: async (file, clientId) => {
        if (!file) return null;
        let fileToUpload = file;

        if (file.type.match(/image.*/)) {
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
                                if (w > h && w > max) { h *= max / w; w = max; }
                                else if (h > max) { w *= max / h; h = max; }
                                canvas.width = w; canvas.height = h;
                                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                                canvas.toBlob(blob => {
                                    if (!blob) return reject(new Error("Blob failed"));
                                    console.log('Tamanho compr.:', (blob.size / 1024).toFixed(2), 'KB');
                                    resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                                }, 'image/jpeg', 0.75);
                            } catch (err) {
                                reject(err);
                            }
                        };
                        img.onerror = () => { clearTimeout(timer); reject(new Error("Formato não suportado para compressão (ex: HEIC)")); };
                        img.src = e.target.result;
                    };
                    reader.onerror = () => { clearTimeout(timer); reject(new Error("Falha ao ler o arquivo")); };
                    reader.readAsDataURL(file);
                });
            } catch (e) {
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

const auth = {
    login: async (email, password) => {
        const users = await db.getUsers();
        const user = users.find(u => u.email === email && u.password === password && u.status !== 'Negado');
        if (user) {
            currentUser = user;
            localStorage.setItem('crm_current_user', JSON.stringify(user));
            return true;
        }
        return false;
    },
    register: async (name, email, password) => {
        const users = await db.getUsers();
        if (users.find(u => u.email === email)) return false;
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
const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

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
    document.querySelectorAll('.theme-switch input').forEach(cb => { cb.checked = next === 'dark'; });
};


async function navigate(route, data = null) {
    const app = document.getElementById('app');

    if (route === 'login') app.innerHTML = ViewLogin();
    else if (route === 'register') app.innerHTML = ViewRegister();
    else if (route === 'dashboard') {
        if (!currentUser) return navigate('login');
        app.innerHTML = '<div style="text-align:center; padding: 3rem; font-size: 1.2rem; color: var(--text-main);">Carregando dados na Nuvem...</div>';
        app.innerHTML = await ViewDashboard();
    }
    else if (route === 'simulation') {
        if (!currentUser) return navigate('login');
        app.innerHTML = ViewSimulation(data);
    }
    else if (route === 'quickSim') {
        if (!currentUser) return navigate('login');
        app.innerHTML = ViewQuickSim();
    }
    else if (route === 'commissions') {
        if (!currentUser) return navigate('login');
        app.innerHTML = '<div style="text-align:center; padding: 3rem; font-size: 1.2rem; color: var(--text-main);">Calculando comissões na Nuvem...</div>';
        app.innerHTML = await ViewCommissions();
    }
    else if (route === 'gallery') {
        if (!currentUser) return navigate('login');
        app.innerHTML = '<div style="text-align:center; padding: 3rem; font-size: 1.2rem; color: var(--text-main);">Carregando Feed de Contas...</div>';
        app.innerHTML = await ViewGallery();
    }
    else if (route === 'clientView') {
        if (!currentUser) return navigate('login');
        app.innerHTML = ViewClientDetailsOnly(data);
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
        <div class="nav-item ${active === 'quickSim' ? 'active' : ''}" onclick="navigate('quickSim')">Simulação Rápida</div>
        <div class="nav-item ${active === 'simulation' ? 'active' : ''}" onclick="navigate('simulation')">Fechar Cliente</div>
        <div class="nav-item ${active === 'commissions' ? 'active' : ''}" onclick="navigate('commissions')">Comissões</div>
        ${isAdmin ? `<div class="nav-item ${active === 'gallery' ? 'active' : ''}" onclick="navigate('gallery')" style="margin-top: 1.5rem; color: #b48500; font-weight: bold;">📸 Feed de Contas</div>` : ''}
        
        <div class="user-info">
            <p style="color: var(--text-main);">${currentUser.name}</p>
            <button onclick="auth.logout()">Sair da conta</button>
            <label class="theme-switch-wrap" title="Alternar tema">
                <span>🌙</span>
                <span class="theme-switch">
                    <input type="checkbox" ${(document.body.getAttribute('data-theme') || 'light') === 'dark' ? 'checked' : ''} onchange="toggleTheme()">
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

    let tableRows = clients.map(c => {
        const clsStatus = c.status.toLowerCase().replace(/\s+/g, '-').replace('ç', 'c').replace('ã', 'a');
        const sellerName = isAdmin ? `<br><small style="color:var(--text-muted)">Vendedor(a): ${users.find(u => String(u.id) === String(c.sellerId))?.name || 'Desconhecido'}</small>` : '';
        return `
        <tr style="cursor: pointer;" onclick="if(event.target.tagName !== 'BUTTON') viewClientDetails('${c.id}')">
            <td><strong>${c.name}</strong>${sellerName}</td>
            <td>${formatCurrency(c.billValue)}</td>
            <td><span class="status-badge status-${clsStatus}">${c.status}</span></td>
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

    if (clients.length === 0) {
        tableRows = '<tr><td colspan="6" style="text-align:center; padding: 2rem;">Nenhum cliente cadastrado ainda.</td></tr>';
    }

    let adminUsersTable = '';
    if (isAdmin) {
        const userRows = users.map(u => {
            const isAdminAcc = u.email === 'vinicius@coopsol.com' || u.email === 'luisvalgas@coopsol.com';
            const isActive = (u.status || 'Ativo') !== 'Negado';

            let actionBtn = '';
            if (!isAdminAcc) {
                if (isActive) {
                    actionBtn = `<button class="btn btn-outline" style="padding: 0.3rem 0.6rem; font-size: 0.75rem; color: var(--danger); border-color: rgba(239, 68, 68, 0.3);" onclick="toggleUserStatus('${u.id}', 'Negado')">Bloquear</button>`;
                } else {
                    actionBtn = `<button class="btn btn-primary" style="padding: 0.3rem 0.6rem; font-size: 0.75rem;" onclick="toggleUserStatus('${u.id}', 'Ativo')">Ativar</button>`;
                }
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
                <h3>Usuários Registrados (Visão Admin)</h3>
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
                <h2>Meus Clientes</h2>
                <div style="display: flex; gap: 1rem;">
                    <button class="btn btn-outline" style="padding: 0.5rem 1rem;" onclick="navigate('quickSim')">Simulação Rápida</button>
                    <button class="btn btn-primary" onclick="navigate('simulation')">+ Fechar Cliente</button>
                </div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card glass">
                    <span class="label">Total de Clientes (Leads + Contratos)</span>
                    <span class="value">${total}</span>
                </div>
                <div class="stat-card glass conversions">
                    <span class="label">Contratos Fechados</span>
                    <span class="value">${converted}</span>
                </div>
            </div>

            <div class="table-container glass">
                <h3>Últimas Simulações</h3>
                <table class="client-list">
                    <thead>
                        <tr>
                            <th>Cliente</th>
                            <th>Conta Base</th>
                            <th>Status</th>
                            <th>Desconto</th>
                            <th>Economia Est.</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
            ${adminUsersTable}
        </div>
    </div>`;
};

const ViewGallery = async () => {
    const isAdmin = currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com';
    if (!isAdmin) return navigate('dashboard');

    const allClients = await db.getClients();
    const accountsWithBill = allClients.filter(c => c.billUrl).reverse();
    const users = await db.getUsers();

    let feedHtml = accountsWithBill.map(c => {
        const seller = users.find(u => String(u.id) === String(c.sellerId))?.name || 'Vendedor Desconhecido';
        const isPdf = c.billUrl.toLowerCase().includes('.pdf?');

        const mediaRender = isPdf
            ? `<div style="width: 100%; height: 350px; background: #fff; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 1rem;"><span style="font-size: 3.5rem;">📄</span><p style="color: #333; font-weight: bold;">Documento em PDF</p><a href="${c.billUrl}" target="_blank" class="btn btn-primary" style="text-decoration: none;">Abrir PDF</a></div>`
            : `<img src="${c.billUrl}" loading="lazy" style="width: 100%; height: 450px; object-fit: cover; cursor: pointer; border-radius: 0;" onclick="window.open('${c.billUrl}')" />`;

        return `
        <div class="glass" style="max-width: 480px; margin: 0 auto 3rem auto; overflow: hidden; padding: 0; animation: fadeInUp 0.5s ease;">
            <div style="padding: 1rem; display: flex; align-items: center; gap: 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05); background: rgba(0,0,0,0.2);">
                <div style="width: 42px; height: 42px; border-radius: 50%; background: linear-gradient(45deg, var(--accent-yellow), var(--accent-primary)); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.2rem; text-transform: uppercase;">${seller.charAt(0)}</div>
                <div style="flex: 1;">
                    <div style="font-weight: bold; font-size: 0.95rem; line-height: 1.2;">${seller}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.2;">Cliente: ${c.name}</div>
                </div>
                <div style="font-size: 0.75rem; color: white; background: rgba(255,255,255,0.1); padding: 0.3rem 0.6rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2);">${c.status}</div>
            </div>
            ${mediaRender}
            <div style="padding: 1.2rem; background: rgba(0,0,0,0.2);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 0.8rem;">
                    <strong style="font-size: 1.1rem;">Fatura Base: ${formatCurrency(c.billValue)}</strong>
                    <strong style="color: var(--accent-green); font-size: 1.1rem;">Econ. ${formatCurrency(c.savings)}</strong>
                </div>
                <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.4;">📍 ${c.address}</p>
                <div style="display: flex; gap: 1rem;">
                    <button class="btn btn-outline" style="flex: 1; padding: 0.6rem; font-size: 0.85rem;" onclick="reactivateClient('${c.id}')">👁️ Ver Cliente</button>
                    ${c.status !== 'Perdida' ? `<button class="btn btn-outline" style="flex: 1; padding: 0.6rem; font-size: 0.85rem; border-color: rgba(239, 68, 68, 0.4); color: var(--danger);" onclick="deactivateClient('${c.id}')">Marcar Perdida</button>` : ''}
                </div>
            </div>
        </div>
        `;
    }).join('');

    if (accountsWithBill.length === 0) {
        feedHtml = '<div style="text-align: center; padding: 4rem; color: var(--text-muted); font-size: 1.1rem;">Nenhuma foto de conta foi postada ainda. 📷</div>';
    }

    return `
    <div class="app-layout">
        ${Sidebar('gallery')}
        <div class="main-content">
            <div class="header" style="justify-content: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 1.5rem; margin-bottom: 2.5rem;">
                <h2>Foto das Contas</h2>
            </div>
            <div style="padding-bottom: 4rem;">
                ${feedHtml}
            </div>
        </div>
    </div>`;
};

const ViewCommissions = async () => {
    const isAdmin = currentUser.email === 'vinicius@coopsol.com' || currentUser.email === 'luisvalgas@coopsol.com';
    const allClients = await db.getClients();
    const users = isAdmin ? await db.getUsers() : [];

    const clients = (isAdmin ? allClients : allClients.filter(c => c.sellerId === currentUser.id))
        .filter(c => c.status === 'Fechado' || c.status === 'Convertido');
    const totalClients = clients.length;

    let totalKwh = 0;
    let totalFirstInvoice = 0;
    let totalMonthly = 0;

    let tableRows = clients.map(c => {
        const bill = parseFloat(c.billValue) || 0;
        const kwh = parseFloat(c.kwh) || 0;
        totalKwh += kwh;

        let firstPercent = 0.30;
        if (bill > 6000) firstPercent = 0.60;
        else if (bill > 3000) firstPercent = 0.50;
        else if (bill > 1000) firstPercent = 0.40;

        const firstInvComm = bill * firstPercent;
        totalFirstInvoice += firstInvComm;

        const monthlyComm = bill * 0.05;
        totalMonthly += monthlyComm;

        const sellerName = isAdmin ? `<br><small style="color:var(--text-muted)">Venda de: ${users.find(u => String(u.id) === String(c.sellerId))?.name || 'Desconhecido'}</small>` : '';

        return `
        <tr>
            <td><strong>${c.name}</strong>${sellerName}</td>
            <td>${formatCurrency(bill)}</td>
            <td style="color: var(--accent-yellow); font-weight: 500;">+ ${formatCurrency(firstInvComm)} <small>(${firstPercent * 100}%)</small></td>
            <td style="color: var(--accent-green); font-weight: 600;">+ ${formatCurrency(monthlyComm)} <small>(5%)</small></td>
        </tr>
        `;
    }).join('');

    if (clients.length === 0) {
        tableRows = '<tr><td colspan="4" style="text-align:center; padding: 2rem;">Nenhuma comissão registrada ainda. Feche contratos para visualizar.</td></tr>';
    }

    const baseCommission = totalFirstInvoice + totalMonthly;

    let bonusPercent = 0;
    if (totalKwh > 60000) bonusPercent = 0.30;
    else if (totalKwh > 30000) bonusPercent = 0.20;
    else if (totalKwh > 10000) bonusPercent = 0.10;

    const bonusValue = baseCommission * bonusPercent;
    const finalCommission = baseCommission + bonusValue;

    return `
    <div class="app-layout">
        ${Sidebar('commissions')}
        <div class="main-content">
            <div class="header">
                <h2>Cálculo Avançado de Comissões</h2>
            </div>
            
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                <div class="stat-card glass">
                    <span class="label">Volume Vendido (Mês)</span>
                    <span class="value" style="color: var(--accent-yellow);">${totalKwh.toLocaleString('pt-BR')} <small>kWh</small></span>
                </div>
                <div class="stat-card glass">
                    <span class="label">Comissão Base Total</span>
                    <span class="value" style="font-size: 1.4rem;">${formatCurrency(baseCommission)}</span>
                </div>
                <div class="stat-card glass" style="border-left: 4px solid var(--accent-yellow);">
                    <span class="label">Bônus por Volume (+${bonusPercent * 100}%)</span>
                    <span class="value" style="color: var(--accent-yellow); font-size: 1.4rem;">+ ${formatCurrency(bonusValue)}</span>
                </div>
                <div class="stat-card glass conversions" style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent-green);">
                    <span class="label">Comissão Final (Mês 1)</span>
                    <span class="value" style="color: var(--accent-green); font-size: 1.8rem;">${formatCurrency(finalCommission)}</span>
                </div>
            </div>

            <div class="table-container glass" style="margin-top: 2rem;">
                <h3>Detalhamento por Cliente</h3>
                <table class="client-list">
                    <thead>
                        <tr>
                            <th>Cliente</th>
                            <th>Valor da Fatura</th>
                            <th>1ª Fatura (Implantação)</th>
                            <th>Recorrente (Mensal)</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        </div>
    </div>`;
};

const ViewSimulation = (client = null) => {
    const cName = client && client.name ? client.name : '';
    const cDoc = client && client.documentId ? client.documentId : '';
    const cAddr = client && client.address ? client.address : '';
    const cKwh = client && client.kwh ? client.kwh : '';
    const cSupply = client && client.supplyClass ? client.supplyClass : 'Monofásico';
    const cKwhPrice = client && client.kwhPrice ? client.kwhPrice : '';
    const cPublicLight = client && client.publicLight !== undefined ? client.publicLight : '';
    const cRep = client && client.repClass ? client.repClass : 'Pessoa Física';

    return `
<div class="app-layout">
    ${Sidebar('simulation')}
    <div class="main-content">
        <div class="sim-container glass">
            <h2>${client ? 'Revisar e Reativar Cliente' : 'Fechar Cliente'}</h2>
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
                    <label>Endereço</label>
                    <input type="text" id="sim-address" value="${cAddr}" required placeholder="Rua, Número, Bairro, Cidade - UF">
                </div>
                <div style="display: flex; gap: 1rem; width: 100%;">
                    <div class="input-group" style="flex: 1;">
                        <label>Média Consumo (12 m) - kWh</label>
                        <input type="number" id="sim-kwh" value="${cKwh}" step="1" min="1" required placeholder="Ex: 300">
                    </div>
                    <div class="input-group" style="flex: 1;">
                        <label>Classe de fornecimento</label>
                        <select id="sim-supply-class" required style="background: rgba(0,0,0,0.3); border: 1px solid var(--panel-border); padding: 0.8rem 1rem; border-radius: 8px; color: var(--text-main); font-size: 1rem; outline: none; width: 100%;">
                            <option value="Monofásico" ${cSupply === 'Monofásico' ? 'selected' : ''}>Monofásico</option>
                            <option value="Bifásico" ${cSupply === 'Bifásico' ? 'selected' : ''}>Bifásico</option>
                            <option value="Trifásico" ${cSupply === 'Trifásico' ? 'selected' : ''}>Trifásico</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; gap: 1rem; width: 100%;">
                    <div class="input-group" style="flex: 1;">
                        <label>Valor kWh Atual (R$)</label>
                        <input type="number" id="sim-kwh-price" value="${cKwhPrice}" step="0.001" min="0.01" required placeholder="Ex: 0.92">
                    </div>
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
                        <option value="Pessoa Física" ${cRep === 'Pessoa Física' ? 'selected' : ''}>Pessoa Física</option>
                        <option value="Pessoa Jurídica" ${cRep === 'Pessoa Jurídica' ? 'selected' : ''}>Pessoa Jurídica</option>
                    </select>
                </div>
                
                <div style="margin-top: 1.5rem; margin-bottom: 1rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1.5rem;">
                    
                    <div style="display: flex; gap: 1rem; width: 100%;">
                        <div class="input-group" style="flex: 1;">
                            <label>RG</label>
                            <input type="text" id="sim-rep-rg" value="${client && client.repRg ? client.repRg : ''}" placeholder="Apenas números">
                        </div>
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
                <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 1rem;">Calcular Viabilidade</button>
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
                        <label>Valor kWh Atual (R$)</label>
                        <input type="number" id="qsim-price" step="0.001" min="0.01" required placeholder="Ex: 0.92">
                    </div>
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
window.handleQuickSim = (e) => {
    e.preventDefault();
    const kwh = parseFloat(document.getElementById('qsim-kwh').value);
    const supplyClass = document.getElementById('qsim-supply').value;
    const kwhPrice = parseFloat(document.getElementById('qsim-price').value);
    const publicLight = parseFloat(document.getElementById('qsim-light').value);

    const value = (kwh * kwhPrice) + publicLight;

    let taxaDisp = 30;
    if (supplyClass === 'Bifásico') taxaDisp = 50;
    if (supplyClass === 'Trifásico') taxaDisp = 100;

    let energiaCompensavel = Math.max(0, kwh - taxaDisp);

    let eligible = false;
    let discount = 0;

    if (kwh <= 250) {
        eligible = false;
    } else if (kwh <= 500) {
        eligible = true;
        discount = 20;
    } else {
        eligible = true;
        discount = 25;
    }

    const coopBill = energiaCompensavel * (1 - (discount / 100)) * kwhPrice;
    const utilityBill = (taxaDisp * kwhPrice) + publicLight;
    const newBill = Math.max(0, coopBill + utilityBill);
    const savings = Math.max(0, value - newBill);

    const resultBox = document.getElementById('quick-result-box');

    if (eligible) {
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

    if (!email.toLowerCase().endsWith('@coopsol.com')) {
        alert('Usuário não autorizado.');
        return;
    }

    if (await auth.login(email, pwd)) {
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

    if (!email.toLowerCase().endsWith('@coopsol.com')) {
        const users = await db.getUsers();
        if (!users.find(u => u.email === email)) {
            await db.saveUser({ id: Date.now().toString(), name, email, password: pwd, status: 'Negado' });
        }
        alert('Usuário não autorizado.');
        return;
    }

    if (await auth.register(name, email, pwd)) {
        alert('Conta criada! Faça login.');
        navigate('login');
    } else {
        alert('Este e-mail já está em uso.');
    }
};

let currentSimData = null;

window.handleSimulation = (e, editId = null) => {
    e.preventDefault();
    const name = document.getElementById('sim-name').value;
    const documentId = document.getElementById('sim-document').value;
    const address = document.getElementById('sim-address').value;
    const supplyClass = document.getElementById('sim-supply-class').value;
    const kwhPrice = parseFloat(document.getElementById('sim-kwh-price').value);
    const publicLight = parseFloat(document.getElementById('sim-public-light').value);
    const repClass = document.getElementById('sim-rep-class').value;

    // Novos campos do Representante Legal
    const repName = document.getElementById('sim-rep-name').value;
    const repCpf = document.getElementById('sim-rep-cpf').value;
    const repRg = document.getElementById('sim-rep-rg').value;
    const repNacionality = document.getElementById('sim-rep-nacionality').value;
    const repCivil = document.getElementById('sim-rep-civil').value;
    const repJob = document.getElementById('sim-rep-job').value;
    const repAddress = document.getElementById('sim-rep-address').value;

    const billFileInput = document.getElementById('sim-bill-file');
    const billFile = billFileInput.files.length > 0 ? billFileInput.files[0] : null;

    const kwh = parseFloat(document.getElementById('sim-kwh').value);
    const value = (kwh * kwhPrice) + publicLight; // calculate total bill value dynamically

    let taxaDisp = 30;
    if (supplyClass === 'Bifásico') taxaDisp = 50;
    if (supplyClass === 'Trifásico') taxaDisp = 100;

    let energiaCompensavel = Math.max(0, kwh - taxaDisp);

    let eligible = false;
    let discount = 0;

    if (kwh <= 250) {
        eligible = false;
    } else if (kwh <= 500) {
        eligible = true;
        discount = 20;
    } else {
        eligible = true;
        discount = 25;
    }

    const coopBill = energiaCompensavel * (1 - (discount / 100)) * kwhPrice;
    const utilityBill = (taxaDisp * kwhPrice) + publicLight;
    const newBill = Math.max(0, coopBill + utilityBill);
    const savings = Math.max(0, value - newBill);

    currentSimData = {
        id: editId,
        name,
        documentId,
        address,
        supplyClass,
        kwh,
        kwhPrice,
        publicLight,
        repClass,
        repName,
        repCpf,
        repRg,
        repNacionality,
        repCivil,
        repJob,
        repAddress,
        billFile,
        billUrl: currentSimData ? currentSimData.billUrl : null,
        billValue: value,
        discountPercent: discount,
        savings,
        energiaCompensavel,
        newBill
    };

    const resultBox = document.getElementById('result-box');

    if (eligible) {
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
    if (!currentSimData) return;

    let clientId = currentSimData.id ? currentSimData.id : Date.now().toString();

    // Upload de arquivo
    if (currentSimData.billFile) {
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
        sellerId: currentUser.id,
        name: currentSimData.name,
        documentId: currentSimData.documentId,
        address: currentSimData.address,
        supplyClass: currentSimData.supplyClass,
        kwh: currentSimData.kwh,
        kwhPrice: currentSimData.kwhPrice,
        publicLight: currentSimData.publicLight,
        repClass: currentSimData.repClass,
        repName: currentSimData.repName,
        repCpf: currentSimData.repCpf,
        repRg: currentSimData.repRg,
        repNacionality: currentSimData.repNacionality,
        repCivil: currentSimData.repCivil,
        repJob: currentSimData.repJob,
        repAddress: currentSimData.repAddress,
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

        if (status !== 'Fechado') {
            alert('Cliente salvo na nuvem com sucesso!');
            navigate('dashboard');
        }
    } catch (err) {
        console.error("Database save failed: ", err);
        alert("Falha extrema ao salvar no banco de dados. Tente novamente.");
    } finally {
        const loader = document.getElementById('global-loader');
        if (loader) loader.remove();
    }
};

window.viewClientDetails = async (id) => {
    const clients = await db.getClients();
    const client = clients.find(c => String(c.id) === String(id));
    if (client) {
        navigate('clientView', client);
    }
};

const ViewClientDetailsOnly = (client) => {
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
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Nome / Razão Social</strong>
                    <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-main);">${client.name}</div>
                </div>
                <div>
                    <strong style="color: var(--text-muted); font-size: 0.85rem;">Documento (CPF/CNPJ)</strong>
                    <div style="font-size: 1.1rem; font-weight: 500;">${client.documentId}</div>
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
                    <div style="margin-top: 0.3rem;"><span class="status-badge status-${client.status.toLowerCase().replace(/ /g, '-')}">${client.status}</span></div>
                </div>
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
    if (confirm('Tem certeza que deseja marcar este cliente como Perdida?')) {
        const allClients = await db.getClients();
        const client = allClients.find(c => String(c.id) === String(id));
        if (client) {
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
    if (idx !== -1) {
        navigate('simulation', clients[idx]);
    } else {
        alert('Erro: Cliente não encontrado (ID: ' + id + ')');
    }
};

window.deleteClient = async (id) => {
    if (confirm('Passo 1/2: Você está prestes a excluir este cliente permanentemente. Continuar?')) {
        if (confirm('Passo 2/2: EXCLUSÃO PERMANENTE. Confirmar EXCLUSÃO?')) {
            await db.deleteClient(id);
            navigate('dashboard');
        }
    }
};

window.toggleUserStatus = async (id, newStatus) => {
    if (confirm(`Tem certeza que deseja mudar o acesso deste usuário para ${newStatus}?`)) {
        const users = await db.getUsers();
        let user = users.find(u => String(u.id) === String(id));
        if (user) {
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

    const hoje = new Date();
    const dataFormatada = hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const pjText = currentSimData.repClass === "Pessoa Jurídica"
        ? `QUALIFICAÇÃO – PESSOA JURÍDICA ${currentSimData.name}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${currentSimData.documentId}, com sede à ${currentSimData.address}, neste ato representada por seu(s) representante(s) legal(is), ${currentSimData.repName || '[NOME COMPLETO DO REPRESENTANTE]'}, ${currentSimData.repNacionality || '[nacionalidade]'}, ${currentSimData.repCivil || '[estado civil]'}, ${currentSimData.repJob || '[profissão]'}, portador do RG nº ${currentSimData.repRg || '[RG]'} e inscrito no CPF nº ${currentSimData.repCpf || '[CPF]'}, residente e domiciliado à ${currentSimData.repAddress || '[endereço completo do representante]'}, doravante denominada simplesmente "COOPERADO".`
        : `${currentSimData.name}, ${currentSimData.repNacionality || '[nacionalidade]'}, ${currentSimData.repCivil || '[estado civil]'}, ${currentSimData.repJob || '[profissão]'}, portador do RG nº ${currentSimData.repRg || '[RG]'} e inscrito no CPF nº ${currentSimData.documentId}, residente e domiciliado à ${currentSimData.repAddress || currentSimData.address}, doravante denominado simplesmente "COOPERADO".`;

    const docDefinition = {
        pageSize: 'A4',
        pageMargins: [40, 60, 40, 60],
        content: [
            { text: "CONTRATO DE CESSÃO DO BENEFÍCIO ECONÔMICO DE CRÉDITOS DE ENERGIA ELÉTRICA", style: 'header' },
            { text: "NO ÂMBITO DO SISTEMA DE COMPENSAÇÃO DE ENERGIA ELÉTRICA (SCEE)", style: 'subheader' },

            { text: "Pelo presente instrumento particular, as partes abaixo qualificadas:", margin: [0, 10, 0, 10] },

            { text: "I – COOPERATIVA (ADMINISTRADORA E GESTORA OPERACIONAL)", style: 'boldText' },
            { text: "COOPSOL – COOPERATIVA DE GERAÇÃO DISTRIBUÍDA DE ENERGIA, pessoa jurídica de direito privado, constituída sob a forma de cooperativa, inscrita no CNPJ nº 00.000.000/0001-00, com sede em Centro, São Paulo - SP, neste ato representada na forma de seu Estatuto Social, doravante denominada simplesmente \"COOPERATIVA\".", style: 'paragraph' },

            { text: "II – COOPERADO (UNIDADE CONSUMIDORA BENEFICIÁRIA)", style: 'boldText' },
            { text: pjText, style: 'paragraph' },

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
            { text: "CNPJ: 00.000.000/0001-00", alignment: 'center' },
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
            { text: "Razão Social: COOPSOL\nCNPJ: 00.000.000/0001-00", style: 'paragraph' },

            { text: "2. IDENTIFICAÇÃO DO COOPERADO", style: 'boldText' },
            { text: `Razão Social / Nome: ${currentSimData.name}\n${currentSimData.repClass === 'Pessoa Jurídica' ? 'CNPJ' : 'CPF'}: ${currentSimData.documentId}`, style: 'paragraph' },

            { text: "3. UNIDADES CONSUMIDORAS", style: 'boldText' },
            {
                table: {
                    headerRows: 1,
                    widths: ['auto', '*', 'auto', 'auto'],
                    body: [
                        [{ text: 'UC', bold: true }, { text: 'Endereço', bold: true }, { text: '% Rateio', bold: true }, { text: 'Consumo', bold: true }],
                        ['Principal', currentSimData.address, '100%', `${currentSimData.kwh} kWh`]
                    ]
                },
                margin: [0, 0, 0, 15]
            },

            { text: "4. CONDIÇÕES COMERCIAIS", style: 'boldText' },
            { text: `• Desconto: ${currentSimData.discountPercent} %\n• Forma de pagamento: Boleto / PIX\n• Responsável pela cobrança: COOPERATIVA\n• Periodicidade: Mensal`, style: 'paragraph' },

            { text: "5. PRAZO", style: 'boldText' },
            { text: "12 meses com renovação automática", style: 'paragraph' },

            { text: "6. DECLARAÇÕES", style: 'boldText' },
            { text: "✔ Não há compra de energia\n✔ Operação via SCEE\n✔ Aceite integral do contrato", style: 'paragraph' },

            { text: "7. ASSINATURAS", style: 'boldText', margin: [0, 20, 0, 10] },
            { text: "COOPERATIVA: ___________________________\n\nCOOPERADO: ___________________________", style: 'paragraph', margin: [0, 0, 0, 30] }
        ],
        styles: {
            header: { fontSize: 14, bold: true, alignment: 'center', margin: [0, 0, 0, 5] },
            subheader: { fontSize: 12, bold: true, alignment: 'center', margin: [0, 0, 0, 20] },
            boldText: { fontSize: 11, bold: true, margin: [0, 10, 0, 5] },
            paragraph: { fontSize: 11, alignment: 'justify', margin: [0, 0, 0, 10] }
        }
    };

    pdfMake.createPdf(docDefinition).download(`Contrato_CoopSol_${currentSimData.name.replace(/\s+/g, '')}.pdf`);

    // Salva o cliente como Fechado após emitir
    await saveClient('Fechado');
    navigate('dashboard');
};

window.updateSimSavings = () => {
    if (!currentSimData) return;
    const inputEl = document.getElementById('custom-discount');
    const newDiscount = parseFloat(inputEl.value) || 0;

    let taxaDisp = 30;
    if (currentSimData.supplyClass === 'Bifásico') taxaDisp = 50;
    if (currentSimData.supplyClass === 'Trifásico') taxaDisp = 100;

    const coopBill = currentSimData.energiaCompensavel * (1 - (newDiscount / 100)) * currentSimData.kwhPrice;
    const utilityBill = (taxaDisp * currentSimData.kwhPrice) + currentSimData.publicLight;

    const newBill = Math.max(0, coopBill + utilityBill);
    const newSavings = Math.max(0, currentSimData.billValue - newBill);

    currentSimData.discountPercent = newDiscount;
    currentSimData.savings = newSavings;
    currentSimData.newBill = newBill;

    const savingsEl = document.getElementById('savings-display');
    const newBillEl = document.getElementById('new-bill-display');

    if (savingsEl) savingsEl.innerText = formatCurrency(newSavings) + '/mês';
    if (newBillEl) newBillEl.innerText = formatCurrency(newBill);
};

// Start App
if (currentUser) navigate('dashboard');
else navigate('login');
