// Vercel Serverless Function - api/enviar-contrato.js
// Proxy para evitar problemas de CORS e manter o token seguro

module.exports = async (req, res) => {
  // Habilitar CORS para permitr chamadas do frontend
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { filename, pdfBase64, emailCliente } = req.body;

    if (!pdfBase64 || !emailCliente) {
      return res.status(400).json({ error: "Dados incompletos (pdfBase64 ou emailCliente faltando)" });
    }

    const AUTENTIQUE_TOKEN = process.env.AUTENTIQUE_TOKEN;
    if (!AUTENTIQUE_TOKEN) {
      return res.status(500).json({ error: "Token do Autentique não configurado. Adicione AUTENTIQUE_TOKEN nas variáveis de ambiente do Vercel." });
    }
    const GRAPHQL_URL = 'https://api.autentique.com.br/v2/graphql';

    // Converter Base64 para Buffer
    const buffer = Buffer.from(pdfBase64, 'base64');

    // Preparar o multipart/form-data manual (já que o Autentique exige o padrão GraphQL multipart)
    const operations = JSON.stringify({
        query: `
            mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
                createDocument(document: $document, signers: $signers, file: $file) {
                    id
                    name
                }
            }
        `,
        variables: {
            document: { name: filename || "Contrato Coopsol" },
            signers: [
                { email: emailCliente, action: 'SIGN' },
                { email: 'vinicius.pereira@callieres.com', action: 'SIGN' }
            ],
            file: null
        }
    });

    const map = JSON.stringify({ "0": ["variables.file"] });

    // No Node.js ambiente Vercel, usamos FormData se disponível ou criamos o corpo manual
    // Para garantir compatibilidade total, vamos usar a abordagem de FormData se o ambiente suportar
    // Caso contrário, uma alternativa seria o pacote 'form-data', mas não queremos instalar deps extras se possível.
    
    // Vercel Serverless Functions (Node.js 18+) suportam FormData nativo.
    const formData = new FormData();
    formData.append('operations', operations);
    formData.append('map', map);
    
    // Criar um Blob a partir do Buffer para o FormData
    const blob = new Blob([buffer], { type: 'application/pdf' });
    formData.append('0', blob, filename || 'contrato.pdf');

    const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AUTENTIQUE_TOKEN}`
        },
        body: formData
    });

    const result = await response.json();
    console.log("Resultado Autentique:", result);

    if (result.errors) {
        return res.status(400).json({ ok: false, errors: result.errors });
    }

    return res.status(200).json({
      ok: true,
      document: result.data.createDocument,
    });

  } catch (error) {
    console.error("Erro no Proxy Autentique:", error);
    return res.status(500).json({ error: error.message });
  }
};
