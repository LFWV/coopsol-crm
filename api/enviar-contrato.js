module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { nome, emailCliente, emailEmpresa } = req.body;

    // 🔹 contrato simples (depois vamos melhorar)
    const contratoHTML = `
      <h1>Contrato</h1>
      <p>Cliente: ${nome}</p>
      <p>Email: ${emailCliente}</p>
    `;

    const base64PDF = Buffer.from(contratoHTML).toString("base64");

    const response = await fetch("https://api.autentique.com.br/v2/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.AUTENTIQUE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          mutation {
            createDocument(
              document: { name: "Contrato ${nome}" },
              signers: [
                { email: "${emailCliente}", action: SIGN },
                { email: "${emailEmpresa}", action: SIGN }
              ],
              file: "${base64PDF}"
            ) {
              id
            }
          }
        `,
      }),
    });

    const data = await response.json();

    console.log("RESPOSTA AUTENTIQUE:", data);

    return res.status(200).json({
      ok: true,
      documentId: data?.data?.createDocument?.id || null,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};
