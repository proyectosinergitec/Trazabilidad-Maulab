const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const path = require('path');
const QRCode = require('qrcode'); // Librería para generar los códigos QR
require('dotenv').config();

// Forzar la zona horaria a la de México para todo el servidor
process.env.TZ = 'America/Mexico_City';

const app = express();

// --- CONFIGURACIÓN DE EXPRESS ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'sinergitec_trazabilidad_2026',
    resave: false,
    saveUninitialized: false
}));

// --- CONEXIÓN A LA BASE DE DATOS ---
const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: 'Z' // Asegura que las fechas de Railway se lean correctamente como UTC
});

// --- PARCHE AUTOMÁTICO PARA LA BASE DE DATOS ---
// Ajusta las columnas para aceptar textos más largos y evitar el error "Data truncated"
(async () => {
    try {
        await db.query("ALTER TABLE asignaciones MODIFY COLUMN estado_asignacion VARCHAR(50) DEFAULT 'Asignada'");
        await db.query("ALTER TABLE solicitudes MODIFY COLUMN estado VARCHAR(50) DEFAULT 'Pendiente'");
        console.log("✔️ Esquema de BD verificado/ajustado correctamente.");
    } catch (err) {
        console.error("⚠️ Nota al ajustar BD:", err.message);
    }
})();

// --- RUTA DE LOGIN ---
app.get('/', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await db.query('SELECT * FROM usuarios WHERE email = ? AND password = ?', [email, password]);
        if (rows.length > 0) {
            const user = rows[0];
            const roleMap = {
                'admin': 'administrador',
                'clinic': 'clinica',
                'collector': 'recolector'
            };
            const routeRole = roleMap[user.rol] || user.rol;
            req.session.userId = user.id;
            req.session.userNombre = user.nombre;
            req.session.rol = routeRole;
            res.redirect(`/${routeRole}/dashboard`);
        } else {
            res.send('Credenciales incorrectas. <a href="/">Volver</a>');
        }
    } catch (e) {
        console.error('Login error:', e.message, e);
        res.status(500).send("Error interno del servidor");
    }
});

// --- DASHBOARD CLÍNICA (SOLICITUDES) ---
app.get('/clinica/dashboard', async (req, res) => {
    if (req.session.rol !== 'clinica') return res.redirect('/');
    try {
        const [solicitudes] = await db.query(
            'SELECT * FROM solicitudes WHERE clinica_id = ? ORDER BY fecha_creacion DESC', 
            [req.session.userId]
        );
        res.render('clinica/dashboard', { nombre: req.session.userNombre, solicitudes });
    } catch (e) { res.status(500).send("Error al cargar solicitudes"); }
});

app.post('/clinica/solicitar-multiple', async (req, res) => {
    const { muestras } = req.body;
    const clinicaId = req.session.userId;
    try {
        const valores = muestras.map(m => [clinicaId, m.tipo, m.urgencia, 'Pendiente']);
        await db.query('INSERT INTO solicitudes (clinica_id, tipo_muestra, urgencia, estado) VALUES ?', [valores]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// --- DASHBOARD ADMINISTRADOR (LOGÍSTICA Y MONITOREO) ---
app.get('/administrador/dashboard', async (req, res) => {
    if (req.session.rol !== 'administrador') return res.redirect('/');
    try {
        // 1. Solicitudes Pendientes (Para planear en el mapa)
        const [solicitudes] = await db.query(`
            SELECT s.*, u.nombre AS nombre_clinica, u.latitud, u.longitud 
            FROM solicitudes s 
            JOIN usuarios u ON s.clinica_id = u.id 
            WHERE s.estado = 'Pendiente'
            ORDER BY CASE WHEN s.urgencia = 'Urgente' THEN 1 ELSE 2 END ASC, s.fecha_creacion ASC
        `);

        // Calcular la distancia (en línea recta) desde el Laboratorio Central
        const labLat = 19.366668413641182;
        const labLng = -99.19010865315482;
        const calcularDistancia = (lat1, lon1, lat2, lon2) => {
            const R = 6371; // Radio de la Tierra en km
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(2);
        };

        solicitudes.forEach(sol => {
            sol.distancia = calcularDistancia(labLat, labLng, parseFloat(sol.latitud), parseFloat(sol.longitud));
        });

        // 2. Solicitudes Asignadas (Monitoreo en tiempo real debajo del mapa)
        const [asignadas] = await db.query(`
            SELECT 
                s.id AS solicitud_id,
                s.tipo_muestra,
                s.urgencia,
                u_clinica.nombre AS nombre_clinica,
                u_recolector.nombre AS nombre_recolector,
                a.fecha_asignacion,
                a.estado_asignacion
            FROM asignaciones a
            JOIN solicitudes s ON a.solicitud_id = s.id
            JOIN usuarios u_clinica ON s.clinica_id = u_clinica.id
            JOIN usuarios u_recolector ON a.recolector_id = u_recolector.id
            WHERE a.estado_asignacion != 'Entregada' 
            ORDER BY a.fecha_asignacion DESC
        `);

        res.render('admin/dashboard', { 
            nombre: req.session.userNombre, 
            solicitudes,
            asignadas,
            mapboxToken: process.env.MAPBOX_TOKEN
        });
    } catch (e) { 
        console.error('Admin dashboard error:', e.message, e);
        res.status(500).send("Error en el panel de administrador"); 
    }
});

app.get('/administrador/asignar/:ids', async (req, res) => {
    const solicitudesIds = req.params.ids;
    try {
        const [recolectores] = await db.query("SELECT id, nombre FROM usuarios WHERE rol = 'recolector'");
        res.render('admin/seleccionar_recolor', { solicitudesIds, recolectores });
    } catch (e) { res.status(500).send("Error"); }
});

app.post('/administrador/confirmar-asignacion', async (req, res) => {
    const { recolectorId, solicitudesIds } = req.body;

    if (!recolectorId || !solicitudesIds) {
        return res.status(400).send("Faltan datos para la asignación. Se requiere un recolector y al menos una solicitud.");
    }

    // Filtra IDs vacíos que podrían resultar de comas extra (ej. "1,2,")
    const idsArray = solicitudesIds.split(',').filter(id => id.trim() !== '');

    if (idsArray.length === 0) {
        return res.status(400).send("No se proporcionaron IDs de solicitud válidos.");
    }

    let connection;
    try {
        // Usar una transacción para asegurar que ambas operaciones (INSERT y UPDATE) se completen con éxito.
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Convertir IDs a números para evitar errores de tipo de dato en la BD.
        const numericIds = idsArray.map(id => parseInt(id, 10));
        const recolectorIdNum = parseInt(recolectorId, 10);

        // 1. Insertar las nuevas asignaciones
        const valoresInsert = numericIds.map(id => [recolectorIdNum, id, 'Pendiente']);
        await connection.query('INSERT INTO asignaciones (recolector_id, solicitud_id, estado_asignacion) VALUES ?', [valoresInsert]);

        // 2. Actualizar el estado de las solicitudes originales
        await connection.query('UPDATE solicitudes SET estado = "Asignada" WHERE id IN (?)', [numericIds]);

        await connection.commit();
        res.redirect('/administrador/dashboard');

    } catch (e) {
        if (connection) await connection.rollback(); // Si algo falla, revertir los cambios.
        console.error('Error al procesar la asignación:', e); // Registrar el error detallado para depuración.
        res.status(500).send("Error al procesar la asignación. El error ha sido registrado en el servidor.");
    } finally {
        if (connection) connection.release(); // Liberar la conexión de vuelta al pool.
    }
});

// --- DASHBOARD RECOLECTOR (MAPA Y VALIDACIÓN QR) ---
app.get('/recolector/dashboard', async (req, res) => {
    if (req.session.rol !== 'recolector') return res.redirect('/');
    try {
        const [rutasRaw] = await db.query(`
            SELECT 
                a.solicitud_id AS asignacion_id, 
                a.estado_asignacion AS estado_asignacion, 
                s.tipo_muestra, 
                s.urgencia, 
                s.fecha_creacion,
                u.nombre AS clinica, 
                u.direccion,
                u.latitud, 
                u.longitud 
            FROM asignaciones a
            JOIN solicitudes s ON a.solicitud_id = s.id
            JOIN usuarios u ON s.clinica_id = u.id
            WHERE a.recolector_id = ? AND a.estado_asignacion != 'Entregada'
        `, [req.session.userId]);
        
        // Normalizar datos para evitar fallos de validación estricta en el frontend
        const rutas = rutasRaw.map(r => ({
            ...r,
            asignacion_id: parseInt(r.asignacion_id, 10), // Forzar a número estricto
            id: parseInt(r.asignacion_id, 10),            // Respaldo por si el frontend busca .id
            estado: r.estado_asignacion                   // Respaldo por si el frontend busca .estado
        }));

        // Calcular la distancia (en línea recta) desde el Laboratorio Central
        const labLat = 19.366668413641182;
        const labLng = -99.19010865315482;
        const calcularDistancia = (lat1, lon1, lat2, lon2) => {
            const R = 6371; // Radio de la Tierra en km
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            return (R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))).toFixed(2);
        };
        rutas.forEach(r => {
            r.distancia = calcularDistancia(labLat, labLng, parseFloat(r.latitud), parseFloat(r.longitud));
        });

        res.render('recolector/dashboard', { 
            nombre: req.session.userNombre, 
            rutas,
            mapboxToken: process.env.MAPBOX_TOKEN
        });
    } catch (e) { res.status(500).send("Error al cargar ruta"); }
});

app.post('/recolector/actualizar-estado', async (req, res) => {
    const { asignacionId, nuevoEstado } = req.body; // asignacionId aquí es el ID de la solicitud
    try {
        // 1. Actualizar la asignación
        await db.query('UPDATE asignaciones SET estado_asignacion = ? WHERE solicitud_id = ?', [nuevoEstado, asignacionId]);
        
        // 2. Sincronizar con la solicitud original
        await db.query('UPDATE solicitudes SET estado = ? WHERE id = ?', [nuevoEstado, asignacionId]);
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// --- RUTA PARA GENERAR LA ETIQUETA QR PROFESIONAL ---
app.get('/generar-qr/:id', async (req, res) => {
    const idSolicitud = req.params.id;
    try {
        const [rows] = await db.query('SELECT * FROM solicitudes WHERE id = ?', [idSolicitud]);
        
        if (rows.length === 0) return res.status(404).send("Solicitud no encontrada");
        
        const sol = rows[0];
        const qrDataURL = await QRCode.toDataURL(`SOL-${idSolicitud}`);
        
        res.send(`
            <html>
            <head>
                <title>Etiqueta Sinergitec - SOL-${idSolicitud}</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f0f2f5; }
                    .ticket { background: white; width: 320px; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border: 1px solid #ddd; text-align: center; }
                    .header { border-bottom: 2px solid #3498db; margin-bottom: 15px; padding-bottom: 10px; }
                    .header h2 { margin: 0; color: #2c3e50; font-size: 1.3em; letter-spacing: 1px; }
                    .qr-img { width: 160px; margin: 10px 0; border: 1px solid #eee; padding: 5px; }
                    .id-text { font-size: 1.2em; font-weight: bold; color: #3498db; margin-bottom: 15px; }
                    .detalle-container { text-align: left; background: #f9f9f9; padding: 10px; border-radius: 8px; border: 1px solid #eee; margin-bottom: 15px; }
                    .detalle-item { font-size: 0.85em; margin: 5px 0; color: #333; }
                    .detalle-item strong { color: #2c3e50; }
                    .urgencia-tag { 
                        display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 0.75em; font-weight: bold; text-transform: uppercase;
                        background: ${sol.urgencia === 'Urgente' ? '#ffcccc' : '#ccffdd'};
                        color: ${sol.urgencia === 'Urgente' ? '#cc0000' : '#006622'};
                    }
                    .footer { font-size: 0.7em; color: #999; margin-top: 10px; border-top: 1px dashed #ccc; padding-top: 10px; }
                    button { width: 100%; padding: 10px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 10px; }
                    @media print {
                        body { background: white; }
                        .ticket { box-shadow: none; border: 1px solid #000; width: 100%; }
                        button { display: none; }
                    }
                </style>
            </head>
            <body>
                <div class="ticket">
                    <div class="header">
                        <h2>SINERGITEC</h2>
                        <small>Logística de Trazabilidad</small>
                    </div>
                    <div class="id-text">SOL-${idSolicitud}</div>
                    <div class="detalle-container">
                        <div class="detalle-item"><strong>Muestra:</strong> ${sol.tipo_muestra}</div>
                <div class="detalle-item"><strong>Pedido:</strong> ${new Date(sol.fecha_creacion).toLocaleDateString('es-MX')} - ${new Date(sol.fecha_creacion).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit', hour12: true})}</div>
                        <div class="detalle-item"><strong>Prioridad:</strong> <span class="urgencia-tag">${sol.urgencia}</span></div>
                    </div>
                    <img src="${qrDataURL}" class="qr-img">
                    <div class="footer">
                        Verifique que el ID coincida con el contenedor.<br>
                        <strong>Sinergitec S.A. de C.V.</strong>
                    </div>
                    <button onclick="window.print()">🖨️ IMPRIMIR ETIQUETA</button>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error al generar etiqueta detallada");
    }
});

// --- HISTORIAL PARA EL ADMINISTRADOR ---
app.get('/administrador/historial', async (req, res) => {
    if (req.session.rol !== 'administrador') return res.redirect('/');
    try {
        const [historial] = await db.query(`
            SELECT s.*, u.nombre AS nombre_clinica, a.fecha_asignacion, rec.nombre AS nombre_recolector
            FROM solicitudes s
            JOIN usuarios u ON s.clinica_id = u.id
            JOIN asignaciones a ON s.id = a.solicitud_id
            JOIN usuarios rec ON a.recolector_id = rec.id
            WHERE s.estado = 'Entregada'
            ORDER BY a.fecha_asignacion DESC
        `);
        res.render('admin/historial', { nombre: req.session.userNombre, historial });
    } catch (e) { res.status(500).send("Error al cargar historial"); }
});

// --- LOGOUT ---
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// --- INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('-------------------------------------------');
    console.log('🚀 Sinergitec Logistics operando en:');
    console.log(`👉 http://localhost:${PORT}`);
    console.log('-------------------------------------------');
});
