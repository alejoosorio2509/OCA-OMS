const fs = require('fs');
const firstLine = fs.readFileSync('c:\\Users\\USERS\\Documents\\KNIME LIGI\\Actualizacion.csv', 'utf16le').split('\n')[0];
console.log('Headers (UTF-16LE):', firstLine);
const firstLine2 = fs.readFileSync('c:\\Users\\USERS\\Documents\\KNIME LIGI\\Actualizacion.csv', 'utf8').split('\n')[0];
console.log('Headers (UTF-8):', firstLine2);
