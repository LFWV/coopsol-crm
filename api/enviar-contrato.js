module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const body = req.body;

    console.log("DADOS RECEBIDOS:", body);

    return res.status(200).json({
      ok: true,
      recebido: body
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
