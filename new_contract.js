window.closeContract = async () => {
    if (!currentSimData) return;
    
    const hoje = new Date();
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const dataFormatada = `${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`;

    const pjText = currentSimData.repClass === "Pessoa Jurídica" 
        ? `${currentSimData.name}, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${currentSimData.documentId}, com sede na ${currentSimData.address}, neste ato representada por seu(s) representante(s) legal(is), ${currentSimData.repName || '[NOME COMPLETO DO REPRESENTANTE]'}, ${currentSimData.repNacionality || '[nacionalidade]'}, ${currentSimData.repCivil || '[estado civil]'}, ${currentSimData.repJob || '[profissão]'}, inscrito no CPF nº ${currentSimData.repCpf || '[CPF]'}, residente e domiciliado à ${currentSimData.repAddress || '[endereço completo do representante]'}, doravante denominado simplesmente "COOPERADO".`
        : `${currentSimData.name}, ${currentSimData.repNacionality || '[nacionalidade]'}, ${currentSimData.repCivil || '[estado civil]'}, ${currentSimData.repJob || '[profissão]'}, inscrito no CPF nº ${currentSimData.documentId}, residente e domiciliado na ${currentSimData.address}, doravante denominado simplesmente "COOPERADO".`;

    const docDefinition = {
        pageSize: 'A4',
        pageMargins: [ 50, 100, 50, 60 ],
        content: [
            { text: "CONTRATO DE CESSÃO DO BENEFÍCIO ECONÔMICO DE CRÉDITOS DE ENERGIA ELÉTRICA", style: 'header' },
            { text: "NO ÂMBITO DO SISTEMA DE COMPENSAÇÃO DE ENERGIA ELÉTRICA (SCEE)", style: 'subheader' },
            
            { text: "Pelo presente instrumento particular, as partes abaixo qualificadas:", margin: [0, 10, 0, 10] },
            
            { text: "I – COOPERATIVA (ADMINISTRADORA E GESTORA OPERACIONAL)", style: 'boldText' },
            { text: "COOPSOL – COOPERATIVA DE GERAÇÃO DISTRIBUÍDA DE ENERGIA, pessoa jurídica de direito privado, constituída sob a forma de cooperativa, inscrita no CNPJ nº 33.923.055/0001-22, com sede em Rua Professora Arlinda Andrade, 667, Sagrada Família, Abaeté, CEP: 35.620-000 neste ato representada na forma de seu Estatuto Social, doravante denominada simplesmente “COOPERATIVA”.", style: 'paragraph' },
            
            { text: "II – COOPERADO (UNIDADE CONSUMIDORA BENEFICIÁRIA)", style: 'boldText' },
            { text: pjText, style: 'paragraph' },
            
            { text: "As partes resolvem celebrar o presente contrato, que se regerá pelas cláusulas e condições abaixo, nos termos da Lei nº 14.300/2022, normas da ANEEL e demais legislações aplicáveis.", style: 'paragraph' },
            
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
            { text: `4.1. O COOPERADO fará jus a um desconto de até ${currentSimData.discountPercent}% (trinta e cinco por cento) sobre a tarifa de energia elétrica da distribuidora, incidente sobre a parcela compensável.`, style: 'paragraph' },
            { text: "4.2. O desconto não constitui garantia mínima, estando condicionado à geração efetiva, regras regulatórias, perfil de consumo e fatores tarifários.", style: 'paragraph' },

            { text: "CLÁUSULA QUINTA – DO PREÇO E FORMA DE PAGAMENTO", style: 'boldText' },
            { text: "5.1. O COOPERADO realizará o pagamento diretamente à COOPERATIVA, conforme o volume de energia efetivamente compensado.", style: 'paragraph' },
            { text: "5.2. A COOPERATIVA será responsável por:\\na) emissão de boletos, PIX ou outros meios de cobrança;\\nb) emissão de documentos fiscais, quando aplicável;\\nc) gestão financeira e administrativa;\\nd) controle e cobrança de inadimplência.", style: 'paragraph' },
            { text: "5.3. Em caso de atraso, incidirão:\\na) multa de 2% (dois por cento);\\nb) juros de 1% (um por cento) ao mês;\\nc) correção monetária pelo IGP-M.", style: 'paragraph' },

            { text: "CLÁUSULA SEXTA – DAS OBRIGAÇÕES DA COOPERATIVA", style: 'boldText' },
            { text: "6.1. Compete à COOPERATIVA:\\na) gerir os ativos de geração;\\nb) realizar a alocação dos créditos;\\nc) garantir a operacionalização junto à distribuidora;\\nd) manter conformidade regulatória;\\ne) prestar informações ao COOPERADO;\\nf) realizar faturamento e cobrança.", style: 'paragraph' },

            { text: "CLÁUSULA SÉTIMA – DAS OBRIGAÇÕES DO COOPERADO", style: 'boldText' },
            { text: "7.1. Compete ao COOPERADO:\\na) manter a unidade consumidora regular;\\nb) efetuar os pagamentos nos prazos;\\nc) fornecer informações necessárias;\\nd) não interferir na operação do SCEE.", style: 'paragraph' },

            { text: "CLÁUSULA OITAVA – DA SUSPENSÃO DO BENEFÍCIO", style: 'boldText' },
            { text: "8.1. Em caso de inadimplência superior a 30 dias, a COOPERATIVA poderá suspender a alocação dos créditos, independentemente de aviso judicial.", style: 'paragraph' },

            { text: "CLÁUSULA NONA – DA RESCISÃO", style: 'boldText' },
            { text: "9.1. O contrato poderá ser rescindido por qualquer das partes mediante aviso prévio de 120 dias.", style: 'paragraph' },
            { text: "9.2. A rescisão antecipada injustificada implicará multa equivalente a 3 meses da média de compensação.", style: 'paragraph' },
            { text: "9.3. Alterações regulatórias que inviabilizem o contrato permitirão rescisão sem multa.", style: 'paragraph' },

            { text: "CLÁUSULA DÉCIMA – DA CONFORMIDADE LEGAL", style: 'boldText' },
            { text: "10.1. As partes declaram que o presente instrumento:\\na) não configura comercialização de energia;\\nb) atende à Lei 14.300/2022;\\nc) caracteriza ato cooperativo;\\nd) possui natureza privada.", style: 'paragraph' },

            { text: "CLÁUSULA DÉCIMA PRIMEIRA – DA FICHA DE MATRÍCULA", style: 'boldText' },
            { text: "11.1. A Ficha de Matrícula integra o presente contrato como Anexo I.", style: 'paragraph' },
            { text: "11.2. Contém dados operacionais, rateio e condições comerciais.", style: 'paragraph' },
            { text: "11.3. Poderá ser atualizada sem aditivo, desde que não altere condições essenciais.", style: 'paragraph' },

            { text: "CLÁUSULA DÉCIMA SEGUNDA – DO FORO", style: 'boldText' },
            { text: "Fica eleito o foro da Comarca de Belo Horizonte/MG.", style: 'paragraph' },

            { text: "ASSINATURAS", style: 'boldText', alignment: 'center', margin: [0, 30, 0, 10] },
            { text: `Belo Horizonte, ${dataFormatada}.`, alignment: 'center', margin: [0, 0, 0, 40] },

            { text: "_______________________________________________________", alignment: 'center' },
            { text: "COOPERATIVA – COOPSOL", alignment: 'center' },
            { text: "CNPJ: 33.923.055/0001-22", alignment: 'center' },
            { text: "Assinatura: ______________________", alignment: 'center', margin: [0, 0, 0, 40] },

            { text: "_______________________________________________________", alignment: 'center' },
            { text: "COOPERADO", alignment: 'center' },
            { text: currentSimData.name, alignment: 'center' },
            { text: `${currentSimData.repClass === 'Pessoa Jurídica' ? 'CNPJ' : 'CPF'}: ${currentSimData.documentId}`, alignment: 'center' },
            { text: "Assinatura: ______________________", alignment: 'center', margin: [0, 0, 0, 40] },

            { text: "TESTEMUNHAS", style: 'boldText', alignment: 'center', margin: [0, 0, 0, 20] },
            { text: "Nome: __________________ CPF: __________________", alignment: 'center', margin: [0, 0, 0, 20] },
            { text: "Nome: __________________ CPF: __________________", alignment: 'center' },

            // ANEXO I
            { text: "ANEXO I – FICHA DE MATRÍCULA DO COOPERADO", style: 'header', pageBreak: 'before', margin: [0, 20, 0, 20] },
            
            { text: "1. IDENTIFICAÇÃO DA COOPERATIVA", style: 'boldText' },
            { text: "Razão Social: COOPSOL\\nCNPJ: 33.923.055/0001-22", style: 'paragraph' },

            { text: "2. IDENTIFICAÇÃO DO COOPERADO", style: 'boldText' },
            { text: `Razão Social / Nome: ${currentSimData.name}\n${currentSimData.repClass === 'Pessoa Jurídica' ? 'CNPJ' : 'CPF'}: ${currentSimData.documentId}`, style: 'paragraph' },

            { text: "3. UNIDADES CONSUMIDORAS", style: 'boldText' },
            {
                table: {
                    headerRows: 1,
                    widths: ['auto', '*', 'auto', 'auto'],
                    body: [
                        [ {text: 'UC', bold: true}, {text: 'Endereço', bold: true}, {text: '% Rateio', bold: true}, {text: 'Consumo', bold: true} ],
                        [ 'Principal', currentSimData.address, '100%', `${currentSimData.kwh} kWh` ]
                    ]
                },
                margin: [0, 0, 0, 15]
            },

            { text: "4. CONDIÇÕES COMERCIAIS", style: 'boldText' },
            { text: `Desconto: ${currentSimData.discountPercent} %\nForma de pagamento: Boleto / PIX\nResponsável pela cobrança: COOPERATIVA\nPeriodicidade: Mensal`, style: 'paragraph' },

            { text: "5. PRAZO", style: 'boldText' },
            { text: "12 meses com renovação automática", style: 'paragraph' },

            { text: "6. DECLARAÇÕES", style: 'boldText' },
            { text: "✔ Não há compra de energia\\n✔ Operação via SCEE\\n✔ Aceite integral do contrato", style: 'paragraph' },

            { text: "7. ASSINATURAS", style: 'boldText', margin: [0, 20, 0, 10] },
            { text: "COOPERATIVA: ___________________________\\n\\nCOOPERADO: ___________________________", style: 'paragraph', margin: [0, 0, 0, 30] }
        ],
        styles: {
            header: { fontSize: 13, bold: true, alignment: 'center', margin: [0, 0, 0, 5] },
            subheader: { fontSize: 11, bold: true, alignment: 'center', margin: [0, 0, 0, 20] },
            boldText: { fontSize: 11, bold: true, margin: [0, 10, 0, 5], decoration: 'underline' },
            paragraph: { fontSize: 11, alignment: 'justify', margin: [0, 0, 0, 10], lineHeight: 1.2 }
        }
    };

    // Gera o PDF
    const pdfDoc = pdfMake.createPdf(docDefinition);
    
    // Download local (opcional, mantido para segurança do vendedor)
    pdfDoc.download(`Contrato_CoopSol_${currentSimData.name.replace(/\s+/g, '')}.pdf`);
    
    // Fluxo Autentique
    document.body.insertAdjacentHTML('beforeend', '<div id="autentique-loader" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.8);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;color:white;font-size:1.2rem;font-weight:bold;"><span>🚀 Enviando para Autentique...</span><small style="margin-top:10px;font-weight:normal;">Assinantes: Cliente e Coopsol</small></div>');

    try {
        const pdfBlob = await new Promise(resolve => pdfDoc.getBlob(resolve));
        const filename = `Contrato_CoopSol_${currentSimData.name.replace(/\s+/g, '')}.pdf`;
        
        const success = await sendToAutentique(pdfBlob, filename, currentSimData.email);
        
        if (success) {
            alert('Contrato enviado com sucesso para assinatura no Autentique!');
        } else {
            alert('O contrato foi baixado, mas houve um erro ao enviar para o Autentique. Por favor, envie manualmente.');
        }
    } catch (e) {
        console.error("Erro Autentique:", e);
        alert('Erro ao processar envio para Autentique: ' + e.message);
    } finally {
        const loader = document.getElementById('autentique-loader');
        if(loader) loader.remove();
    }
    
    // Salva o cliente como Fechado após emitir
    await saveClient('Fechado');
    navigate('dashboard');
};

async function sendToAutentique(pdfBlob, filename, clientEmail) {
    const AUTENTIQUE_TOKEN = '3453d57e0272da53b4d0efd06505bb33cbf18f54784dcb7acc0f5e8177254a1f';
    const GRAPHQL_URL = 'https://api.autentique.com.br/v2/graphql';

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
            document: { name: filename },
            signers: [
                { email: clientEmail, action: 'SIGN' },
                { email: 'vinicius.pereira@callieres.com', action: 'SIGN' }
            ],
            file: null
        }
    });

    const map = JSON.stringify({ "0": ["variables.file"] });

    const formData = new FormData();
    formData.append('operations', operations);
    formData.append('map', map);
    formData.append('0', pdfBlob, filename);

    try {
        const response = await fetch(GRAPHQL_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AUTENTIQUE_TOKEN}`
            },
            body: formData
        });

        const result = await response.json();
        
        if (result.errors) {
            console.error("Autentique GraphQL Errors:", JSON.stringify(result.errors, null, 2));
            alert("Erro do Autentique: " + result.errors.map(e => e.message).join(", "));
            return false;
        }

        console.log("Autentique Success:", result.data.createDocument);
        return true;
    } catch (error) {
        console.error("Fetch Error (CORS or Network):", error);
        alert("Erro de Rede/CORS: Não foi possível conectar ao Autentique. Se estiver abrindo o arquivo localmente pelo navegador, isso pode ser um bloqueio de segurança (CORS). Tente rodar um servidor local ou verifique o console do desenvolvedor (F12).");
        return false;
    }
}
