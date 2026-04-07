const fs = require('fs');

const file = 'new_contract.js';
let content = fs.readFileSync(file, 'utf8');

const b64 = fs.readFileSync('image1.png', 'base64');

// 1. Add Logo Image and logoBase64
const imgInsert = `
    const logoBase64 = "data:image/png;base64," + "${b64}";
`;
content = content.replace("const docDefinition = {", imgInsert + "\n    const docDefinition = {\n        images: { logo: logoBase64 },");

content = content.replace(
    "{ text: \"CONTRATO DE CESSÃO DO BENEFÍCIO ECONÔMICO DE CRÉDITOS DE ENERGIA ELÉTRICA\", style: 'header' },",
    "{ image: 'logo', width: 120, alignment: 'center', margin: [0, 0, 0, 20] },\n            { text: \"CONTRATO DE CESSÃO DO BENEFÍCIO ECONÔMICO DE CRÉDITOS DE ENERGIA ELÉTRICA\", style: 'header' },"
);


// 2. Fix the last page Table
const oldTable = `[ 'Principal', currentSimData.address, '100%', \`\${currentSimData.kwh} kWh\` ]`;
const newTable = `[ currentSimData.ucNumber || "Não Informado", currentSimData.address, '100%', \`\${currentSimData.kwh || 0} kWh\` ]`;
content = content.replace(oldTable, newTable);

// 3. To handle 'desconto' on the last page. The user said: "nao temos a unidade consumidora o consumo e desconto na ultima pagina"
// Let's modify the table header and content to include Desconto
const oldTableHeader = `[ {text: 'UC', bold: true}, {text: 'Endereço', bold: true}, {text: '% Rateio', bold: true}, {text: 'Consumo', bold: true} ],`;
const newTableHeader = `[ {text: 'UC', bold: true}, {text: 'Endereço', bold: true}, {text: '% Rateio', bold: true}, {text: 'Consumo (kWh)', bold: true}, {text: 'Desconto (%)', bold: true} ],`;

const oldTableWidths = `widths: ['auto', '*', 'auto', 'auto'],`;
const newTableWidths = `widths: ['auto', '*', 'auto', 'auto', 'auto'],`;

const finalRow = `[ currentSimData.ucNumber || "Não Informado", currentSimData.address, '100%', \`\${currentSimData.kwh || 0}\`, \`\${currentSimData.discountPercent || 0} %\` ]`;

content = content.replace(oldTableWidths, newTableWidths);
content = content.replace(oldTableHeader, newTableHeader);
content = content.replace(newTable, finalRow);

fs.writeFileSync(file, content);
console.log("Patched successfully!");
