const fs = require('fs');
const firstLine = fs.readFileSync('c:\\Users\\USERS\\Documents\\KNIME LIGI\\Actualizacion.csv', 'latin1').split('\n')[0];
console.log('Headers:', firstLine);
