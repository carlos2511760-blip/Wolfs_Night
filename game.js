let scene, camera, renderer, ambientLight, sunlight, hemiLight, sunMesh, sunLight, floor;
let clock = new THREE.Clock();
let raycaster = new THREE.Raycaster();
let textureLoader = new THREE.TextureLoader();
let lastHowlTime = 0;
let collisionGrid = new Map();
const GRID_SIZE = 20;

// --- SISTEMA DE ÁUDIO SINTETIZADO (WEB AUDIO API) ---
const GameAudio = {
    ctx: null,
    masterVolume: 0.5,
    init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
    playShoot() {
        this.init(); const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = 'square'; gain.gain.setValueAtTime(0.3 * this.masterVolume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + 0.1);
    },
    playHowl() {
        this.init(); const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = 'sawtooth'; gain.gain.setValueAtTime(0.15 * this.masterVolume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 2.0);
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 1.5);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + 2.0);
    },
    playHeartbeat(rate = 1.0) {
        this.init(); const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = 'sine'; gain.gain.setValueAtTime(0.2 * this.masterVolume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
        osc.frequency.setValueAtTime(60, this.ctx.currentTime);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + 0.2);
    },
    playUIClick() {
        this.init(); const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
        osc.type = 'triangle'; gain.gain.setValueAtTime(0.1 * this.masterVolume, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
        osc.frequency.setValueAtTime(800, this.ctx.currentTime);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + 0.05);
    }
};

function getGridKey(x, z) {
    return `${Math.floor(x / GRID_SIZE)}_${Math.floor(z / GRID_SIZE)}`;
}

function addToGrid(obj) {
    const key = getGridKey(obj.x, obj.z);
    if (!collisionGrid.has(key)) collisionGrid.set(key, []);
    collisionGrid.get(key).push(obj);
}

let config = { isTopDown: false, cameraHeight: 25 };
window.config = config;
window.cheatsEnabled = false;
window.isFullBright = false;
window.isFlying = false;

let player = {
    radius: 0.55,
    isGrounded: true, yaw: 0, pitch: 0, model: null,
    lives: 3, maxLives: 3, // Evolução de vida máxima
    flashlightOn: false, flashlightBattery: 250, flashlight: null,
    traps: 2, medkits: 1,
    magAmmo: 15, totalAmmo: 45, magSize: 15, reloading: false,
    exhaustion: 0, isDead: false, cowardTimer: 0, lastActionTime: 0,
    height: 1.7, canMove: false, yaw: 0, pitch: 0,
    velocity: new THREE.Vector3(0, 0, 0),
    sensitivity: 0.002, // Sensibilidade padrão
    isSprinting: false,
    shakeIntensity: 0, // Valor inicial do tremor
    stamina: 100, maxStamina: 100,
    staminaCooldown: false, coStartTime: 0, cooldownDuration: 1.5
};
window.player = player;

let gameStats = {
    phase: "pre-game",
    prepTimer: 180,
    survivalTimer: 600,
    night: 1,
    wolves: [],
    doors: [],
    placedTraps: [],
    bloodPools: [],
    cabins: []
};
window.gameStats = gameStats;

let interactiveObjects = [];
let damageableObjects = [];
let keys = {};

// --- MATERIAIS COM TEXTURAS (PRONTOS PARA RECEBER ARQUIVOS) ---
let gameMaterials = {};

function initTextures() {
    // 💡 PARA VOCÊ COLOCAR IMAGENS: Baixe as fotos e coloque na mesma pasta do jogo
    // Depois é só mudar o nome no load('nome_da_foto.jpg')

    // 1. TEXTURA DO CHÃO (SELVA)
    const groundTex = textureLoader.load('chao_selva.jpg', () => {
        gameMaterials.ground.map = groundTex;
        gameMaterials.ground.needsUpdate = true;
    }, undefined, () => {
        // Fallback: se não achar a imagem, coloca cor verde para não ficar preto
        gameMaterials.ground.color.setHex(0x155d27);
    });
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(80, 80); // Escala melhor para ver detalhes
    groundTex.colorSpace = THREE.SRGBColorSpace;

    gameMaterials.ground = new THREE.MeshStandardMaterial({
        color: 0x1a1f1a, // Verde musgo escuro (base sólida)
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide
    });

    // 2. TEXTURA DA MADEIRA (CABANAS)
    const woodTex = textureLoader.load('madeira_velha.jpg');
    gameMaterials.cabinWall = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x2b1d0e });

    // 3. TEXTURA DA ÁRVORE (TRONCO)
    const barkTex = textureLoader.load('casca_arvore.jpg');
    gameMaterials.treeTrunk = new THREE.MeshStandardMaterial({ map: barkTex, color: 0x1a110a });

    // 4. TEXTURA DO LOBISOMEM (PELO)
    const wolfTex = textureLoader.load('pelo_lobo.jpg');
    gameMaterials.wolfSkin = new THREE.MeshStandardMaterial({ map: wolfTex, color: 0x000000 });
}

// --- INICIALIZAÇÃO ---
function init() {
    setupOverlayStyles();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020408);
    scene.fog = new THREE.FogExp2(0x020408, 0.005); // Neblina bem mais suave para enxergar longe

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
    camera.rotation.order = "YXZ";
    scene.add(camera);

    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x0a1a0a, 0.3);
    scene.add(hemiLight);

    sunlight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunlight.position.set(200, 400, 200);
    scene.add(sunlight);

    const sunGeom = new THREE.SphereGeometry(25, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffee });
    sunMesh = new THREE.Mesh(sunGeom, sunMat);
    sunLight = new THREE.PointLight(0xffffaa, 500, 1500, 1);
    sunMesh.add(sunLight);
    scene.add(sunMesh);

    initTextures();

    floor = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), gameMaterials.ground);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    createPlayerModel();
    setupWeapon();
    setupFlashlight();
    updateAtmosphere(0);

    createCabin(0, 0, 0);
    for (let i = 0; i < 280; i++) {
        const x = (Math.random() - 0.5) * 4800;
        const z = (Math.random() - 0.5) * 4800;
        if (Math.abs(x) > 130 || Math.abs(z) > 130) createCabin(x, 0, z);
    }

    // --- SISTEMA DE ÁRVORES INSTANCIADAS (ALTA PERFORMANCE) ---
    const treeTrunkGeo = new THREE.CylinderGeometry(0.8, 1.2, 20, 8);
    const instancedTrunks = new THREE.InstancedMesh(treeTrunkGeo, gameMaterials.treeTrunk, 2500);

    const leafGeo = new THREE.ConeGeometry(5, 8, 4);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x031203 });
    const instancedLeaves = [];
    for (let j = 0; j < 6; j++) instancedLeaves.push(new THREE.InstancedMesh(leafGeo, leafMat, 2500));

    const dummy = new THREE.Object3D();
    for (let i = 0; i < 2500; i++) {
        const x = (Math.random() - 0.5) * 5000;
        const z = (Math.random() - 0.5) * 5000;
        const dist = Math.sqrt(x * x + (z - 30) * (z - 30));

        if (dist > 35) {
            dummy.position.set(x, 10, z);
            dummy.updateMatrix();
            instancedTrunks.setMatrixAt(i, dummy.matrix);

            for (let j = 0; j < 6; j++) {
                dummy.position.set(x, 8 + j * 4, z);
                dummy.scale.set(1 - j * 0.1, 1, 1 - j * 0.1);
                dummy.updateMatrix();
                instancedLeaves[j].setMatrixAt(i, dummy.matrix);
            }
            // Adicionar colisão circular simples
            addToGrid({ x, z, r: 1.2 });
        }
    }

    instancedTrunks.instanceMatrix.needsUpdate = true;
    instancedLeaves.forEach(l => l.instanceMatrix.needsUpdate = true);

    scene.add(instancedTrunks);
    instancedLeaves.forEach(l => scene.add(l));

    for (let i = 0; i < 60; i++) {
        const x = (Math.random() - 0.5) * 2000; const z = (Math.random() - 0.5) * 2000;
        if (Math.sqrt(x * x + (z - 30) * (z - 30)) > 35) createCorpse(x, z);
    }
    for (let i = 0; i < 100; i++) {
        const x = (Math.random() - 0.5) * 3000; const z = (Math.random() - 0.5) * 3000;
        if (Math.sqrt(x * x + (z - 30) * (z - 30)) > 35) createHolePit(x, z);
    }

    setupOvergrownJungle();
    setupControls(canvas);

    // Inicialização da câmera
    updatePlayer(0);
    animate();
}

function canSeeWolf() {
    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    return gameStats.wolves.some(w => frustum.intersectsObject(w.children[0]) && player.model.position.distanceTo(w.position) < 80);
}

function triggerExhaustionDeath() {
    player.canMove = false;
    showCentralMessage("VOCÊ CHEGOU AO SEU LIMITE... TÃO CANSADO...", 5000);

    // Cutscene: cair no chão e lobos vindo
    let fallSpeed = 0;
    const fallInterval = setInterval(() => {
        fallSpeed += 0.05;
        player.pitch += 0.05;
        camera.position.y -= fallSpeed;
        if (camera.position.y <= 0.5) {
            camera.position.y = 0.5;
            clearInterval(fallInterval);

            // Invocar lobos em volta
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * Math.PI * 2;
                spawnWolf();
                const w = gameStats.wolves[gameStats.wolves.length - 1];
                w.position.set(player.model.position.x + Math.cos(a) * 5, 0, player.model.position.z + Math.sin(a) * 5);
            }

            setTimeout(() => {
                gameStats.phase = "ended";
                showCentralMessage("DEVORADO NO CHÃO DA FLORESTA 🐺🥩<br><span style='font-size:30px'>VOLTANDO AO MENU...</span>", 8000);
                setTimeout(() => window.location.reload(), 8000);
            }, 3000);
        }
    }, 50);
}

function createCabin(x, y, z) {
    const g = new THREE.Group(); const s = 14; const h = 9;
    const p1 = { x: -s / 2, z: -s / 2 }; const p2 = { x: s / 2, z: -s / 2 }; const p3 = { x: s / 2, z: s / 2 }; const p4 = { x: -s / 2, z: s / 2 }; const d1 = { x: -2.5, z: s / 2 }; const d2 = { x: 2.5, z: s / 2 };
    createRadialWall(p1, p2, { x, z }); createRadialWall(p1, p4, { x, z }); createRadialWall(p2, p3, { x, z }); createRadialWall(p4, d1, { x, z }); createRadialWall(d2, p3, { x, z });
    const wallsVis = [{ g: [s, h, 0.8], p: [0, h / 2, -s / 2] }, { g: [0.8, h, s], p: [-s / 2, h / 2, 0] }, { g: [0.8, h, s], p: [s / 2, h / 2, 0] }, { g: [4.5, h, 0.8], p: [-4.75, h / 2, s / 2] }, { g: [4.5, h, 0.8], p: [4.75, h / 2, s / 2] }];
    wallsVis.forEach(wd => { const wall = new THREE.Mesh(new THREE.BoxGeometry(...wd.g), gameMaterials.cabinWall); wall.position.set(...wd.p); g.add(wall); });

    // PORTA REALISTA COM PIVÔ NA DOBRADIÇA
    const doorPivot = new THREE.Group();
    doorPivot.position.set(-2.5, 0, s / 2); // Pivô na esquerda da porta
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(5, 7, 0.4), new THREE.MeshStandardMaterial({ color: 0x221105 }));
    doorMesh.position.set(2.5, 3.5, 0); // Offset para que a rotação seja na borda
    doorPivot.add(doorMesh);

    doorPivot.userData = { type: "door", isOpen: false, currentAngle: 0, targetAngle: 0, hp: 40, lastAttackTime: 0 };
    g.add(doorPivot);
    interactiveObjects.push(doorMesh); // Clicamos na mesh, mas animamos o pivô
    gameStats.doors.push(doorPivot);

    createRadialWall({ x: -2.5, z: s / 2 }, { x: 2.5, z: s / 2 }, { x, z }, true, doorPivot);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(12, 8, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    roof.position.set(0, h + 3, 0); roof.rotation.y = Math.PI / 4; g.add(roof);

    // --- SISTEMA DE LOOT ABUNDANTE (1 A 4 ITENS) ---
    const randNum = Math.random();
    let numItems = 1;
    if (randNum < 0.15) numItems = 4;
    else if (randNum < 0.40) numItems = 3;
    else if (randNum < 0.70) numItems = 2;

    const lootPositions = [
        { x: -4, z: -4 }, { x: 4, z: -4 }, { x: -4, z: 2 }, { x: 4, z: 3 },
        { x: 0, z: -3 }, { x: 3, z: -1 } // Posições extras
    ];

    // Embaralhar posições
    lootPositions.sort(() => Math.random() - 0.5);

    for (let i = 0; i < numItems; i++) {
        const r = Math.random();
        let lootType = "ammo";
        let lootColor = 0xaa8822;
        let amount = 45; // Aumentado de 25 para 45

        if (r < 0.35) { lootType = "trap"; lootColor = 0x555555; amount = 3; }
        else if (r < 0.55) { lootType = "medkit"; lootColor = 0x22aa22; amount = 1; }

        const loot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: lootColor }));
        const pos = lootPositions[i];
        loot.position.set(pos.x, 0.6, pos.z);
        loot.userData = { type: "loot", subType: lootType, amount: amount };

        g.add(loot);
        interactiveObjects.push(loot);
    }

    g.position.set(x, y, z); scene.add(g);
    gameStats.cabins.push({ model: g, pos: new THREE.Vector3(x, 0, z), hp: 100, lastAttackTime: 0 });
}

function spawnWolf(isAlpha = false) {
    const w = new THREE.Group();
    const size = isAlpha ? 3.5 : 1.2;
    // Pele do Alfa é um roxo escuro quase preto, lobos comuns são cinza escuro
    const skinColor = isAlpha ? 0x1a0a25 : 0x1a1a1a;
    const skinMat = new THREE.MeshStandardMaterial({
        color: skinColor,
        roughness: 0.8,
        metalness: 0.2
    });

    // Olhos do Alfa são Amarelos Brilhantes, comuns são Vermelhos
    const eyeMat = new THREE.MeshBasicMaterial({ color: isAlpha ? 0xffff00 : 0xff0000 });

    // --- CORPO (POSTURA CURVADA) ---
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8 * size, 1.2 * size, 0.8 * size), skinMat);
    torso.position.y = 1.2 * size;
    torso.rotation.x = 0.3; // Curvado para frente
    w.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.0 * size, 1.0 * size, 1.0 * size), skinMat);
    chest.position.set(0, 1.8 * size, 0.4 * size);
    chest.rotation.x = -0.2;
    w.add(chest);

    // --- JUBA / ESPINHOS (EXCLUSIVO DO ALFA) ---
    if (isAlpha) {
        for (let i = 0; i < 5; i++) {
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15 * size, 0.6 * size, 4), skinMat);
            spike.position.set(0, (1.5 + i * 0.3) * size, (0.2 - i * 0.1) * size);
            spike.rotation.x = -0.5;
            w.add(spike);
        }
    }

    // --- CABEÇA ---
    const head = new THREE.Group();
    head.position.set(0, 2.2 * size, 0.8 * size);
    w.add(head);

    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.6 * size, 0.6 * size, 0.6 * size), skinMat);
    head.add(skull);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.4 * size, 0.3 * size, 0.5 * size), skinMat);
    muzzle.position.set(0, -0.1 * size, 0.4 * size);
    head.add(muzzle);

    // Orelhas
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.1 * size, 0.4 * size, 3), skinMat);
    earL.position.set(-0.2 * size, 0.4 * size, 0);
    head.add(earL);
    const earR = earL.clone();
    earR.position.x = 0.2 * size;
    head.add(earR);

    // Olhos Brilhantes
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.08 * size), eyeMat);
    eyeL.position.set(-0.2 * size, 0.1 * size, 0.25 * size);
    head.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.2 * size;
    head.add(eyeR);

    const eyeGlow = new THREE.PointLight(isAlpha ? 0xffff00 : 0xff0000, 2.0 * size, 6 * size);
    eyeGlow.position.set(0, 0.1 * size, 0.4 * size);
    head.add(eyeGlow);

    // --- BRAÇOS (LONGOS E AMEAÇADORES) ---
    const createArm = (side) => {
        const arm = new THREE.Group();
        arm.position.set(0.6 * size * side, 2.0 * size, 0.4 * size);

        const upper = new THREE.Mesh(new THREE.BoxGeometry(0.3 * size, 1.0 * size, 0.3 * size), skinMat);
        upper.position.y = -0.4 * size;
        upper.rotation.z = 0.2 * side;
        arm.add(upper);

        const lower = new THREE.Mesh(new THREE.BoxGeometry(0.25 * size, 1.0 * size, 0.25 * size), skinMat);
        lower.position.set(0.1 * size * side, -1.2 * size, 0.2 * size);
        lower.rotation.x = -0.5;
        arm.add(lower);

        // Garras (Maiores no Alfa)
        const clawSize = isAlpha ? 0.2 : 0.1;
        const claw = new THREE.Mesh(new THREE.BoxGeometry(clawSize * size, 0.4 * size, clawSize * size), new THREE.MeshStandardMaterial({ color: 0x000000 }));
        claw.position.set(0, -1.7 * size, 0.5 * size);
        arm.add(claw);

        return arm;
    };
    w.add(createArm(1));
    w.add(createArm(-1));

    // --- PERNAS ---
    const createLeg = (side) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4 * size, 1.2 * size, 0.4 * size), skinMat);
        leg.position.set(0.4 * size * side, 0.6 * size, 0);
        return leg;
    };
    w.add(createLeg(1));
    w.add(createLeg(-1));

    // --- SPAWN E ATRIBUTOS ---
    const a = Math.random() * Math.PI * 2;
    const spawnDist = 150 + Math.random() * 100;
    w.position.set(
        player.model.position.x + Math.cos(a) * spawnDist,
        0,
        player.model.position.z + Math.sin(a) * spawnDist
    );

    const night = gameStats.night;
    // Noite 1: 5 tiros (100 HP) | Noite 2: 7 tiros (140 HP) | +2 tiros (40 HP) por noite
    const commonHP = (5 + (night - 1) * 2) * 20;
    const baseHp = isAlpha ? 600 : commonHP;
    w.userData = {
        hp: baseHp,
        maxHp: baseHp,
        lastAttack: 0,
        speed: isAlpha ? 7.5 : (5.5 + (night * 0.6)),
        isAlpha: isAlpha,
        dashCooldown: 0,
        isImmune: false,
        immunityCooldown: 0,
        lastInvokeHp: baseHp,
        bobPhase: Math.random() * Math.PI * 2,
        size: size,
        dead: false
    };

    scene.add(w);
    gameStats.wolves.push(w);

    // --- HITBOX DE SEGURANÇA (FACILITA O TIRO) ---
    const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(1.5 * size, 3 * size, 1.5 * size),
        new THREE.MeshBasicMaterial({ visible: false }) // Invisível mas interceptável
    );
    hitbox.position.y = 1.5 * size;
    hitbox.userData.isHitbox = true;
    hitbox.userData.hpOwner = w;
    w.add(hitbox);

    // Vincular TODAS as partes e forçar detecção
    w.traverse(child => {
        if (child instanceof THREE.Mesh) {
            child.userData.hpOwner = w;
            damageableObjects.push(child);
        }
    });
}

// --- SISTEMA DE FASES E UI (MANTIDOS) ---
function showCentralMessage(text, duration = 5000) {
    const msg = document.createElement('div'); msg.id = 'central-msg'; msg.innerHTML = text; document.body.appendChild(msg);
    setTimeout(() => { msg.style.opacity = '0'; setTimeout(() => msg.remove(), duration); }, 100);
}

function showCheatMessage(text) {
    const msg = document.createElement('div');
    msg.style.cssText = `
        position: fixed; bottom: 20px; left: 20px; 
        background: rgba(0, 0, 0, 0.7); color: #ffcc00; 
        padding: 5px 15px; border-left: 3px solid #ffcc00;
        font-family: monospace; font-size: 14px; z-index: 5000;
        pointer-events: none; transition: opacity 0.5s;
    `;
    msg.innerText = `[CHEAT] ${text}`;
    document.body.appendChild(msg);
    setTimeout(() => { msg.style.opacity = '0'; setTimeout(() => msg.remove(), 500); }, 3000);
}

function setupOverlayStyles() {
    const s = document.createElement('style');
    s.innerHTML = `
        #central-msg { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); font-family: 'Creepster', cursive; font-size: 60px; color: #ff0000; text-shadow: 0 0 20px #000; opacity: 1; transition: opacity 5s ease-out; pointer-events: none; z-index: 10000; text-align: center; }
        #top-timer { position: fixed; top: 20px; right: 20px; font-family: 'Courier New', monospace; font-size: 24px; color: #ff3333; background: rgba(0,0,0,0.6); padding: 10px 20px; border-radius: 5px; border-left: 5px solid #ff0000; z-index: 9000; }
        #game-stats-display { position: fixed; top: 20px; left: 20px; font-family: 'Arial', sans-serif; font-size: 18px; color: #fff; background: rgba(0,0,0,0.7); padding: 15px; border-radius: 10px; border: 1px solid #444; z-index: 9000; min-width: 250px; }
        #interaction-label { position: fixed; top: 60%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; color: #fff; background: rgba(0,0,0,0.8); padding: 8px 20px; border-radius: 5px; opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 9000; border: 1px solid #b30000; }
        #backpack-ui { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 350px; padding: 25px; background: rgba(10,10,10,0.95); border: 2px solid #ff0000; border-radius: 15px; display: none; z-index: 11000; color: #fff; text-align: center; font-family: 'Courier New', monospace; box-shadow: 0 0 30px #000; }
        #blood-overlay { 
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; 
            pointer-events: none; z-index: 9500; opacity: 0; transition: opacity 1.5s ease;
            background: radial-gradient(circle, transparent 40%, rgba(139, 0, 0, 0.9) 100%);
            box-shadow: inset 0 0 150px rgba(0,0,0,0.9);
        }
        #stamina-bar { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); width: 300px; height: 15px; background: rgba(0,0,0,0.7); border: 2px solid #555; border-radius: 10px; overflow: hidden; z-index: 10000; }
        #stamina-fill { width: 100%; height: 100%; background: #b30000; transition: width 0.2s; display: flex; align-items: center; justify-content: center; font-family: Arial; font-weight: bold; font-size: 10px; color: white; }
    `;
    document.head.appendChild(s);
    const sn = document.createElement('div'); sn.id = 'stamina-bar'; sn.innerHTML = '<div id="stamina-fill"></div>'; document.body.appendChild(sn);
    const b = document.createElement('div'); b.id = 'blood-overlay'; document.body.appendChild(b);
    const t = document.createElement('div'); t.id = 'top-timer'; document.body.appendChild(t);
    const g = document.createElement('div'); g.id = 'game-stats-display'; document.body.appendChild(g);
    const i = document.createElement('div'); i.id = 'interaction-label'; document.body.appendChild(i);
    const p = document.createElement('div'); p.id = 'backpack-ui'; document.body.appendChild(p);
}

function updateUI() {
    const timerUI = document.getElementById('top-timer');
    if (timerUI) {
        let t = 0; let label = "";
        if (gameStats.phase === "prep" || gameStats.phase === "pre-game") { t = Math.max(0, gameStats.prepTimer); label = "PREPARAÇÃO"; }
        else if (gameStats.phase === "survival" || gameStats.phase === "transition") { t = Math.max(0, gameStats.survivalTimer); label = "SOBREVIVÊNCIA"; }
        let mins = Math.floor(t / 60); let secs = Math.floor(t % 60); timerUI.innerHTML = `${label}: ${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    const st = document.getElementById('stamina-fill');
    if (st) {
        st.style.width = player.stamina + "%";
        if (player.staminaCooldown) { let r = Math.ceil(15 - (clock.getElapsedTime() - player.coStartTime)); st.style.background = "#ff9900"; st.innerHTML = `EXAUSTO ${r}s`; }
        else { st.style.background = "#b30000"; st.innerHTML = ""; }
    }
    const h = document.getElementById('game-stats-display');
    if (h) {
        const exVal = Math.floor(player.exhaustion);
        const exColor = exVal > 80 ? "#ff0000" : (exVal > 50 ? "#ffff00" : "#00ff00");
        const hearts = "❤️".repeat(player.lives) + "🖤".repeat(Math.max(0, player.maxLives - player.lives));
        h.innerHTML = `
            <div style="font-size:24px; color:#ff0000; margin-bottom:5px;">NOITE ${gameStats.night}/7</div>
            <div style="color:#ff4444; font-size:18px;">VIDA: ${hearts}</div>
            <div style="color:#ffcc00; font-weight:bold;">🐺 VIVOS: ${gameStats.wolves.length}</div>
            <div style="color:#aaa;">🔫 PENTE: ${player.magAmmo} | TOTAL: ${player.totalAmmo}</div>
            <div style="color:#aaa;">🪤 ARMADILHAS: ${player.traps}</div>
            <div style="color:#22ff22;">🩹 KITS MÉDICOS: ${player.medkits}</div>
            <div style="color:#aaa;">🔦 BATERIA: ${Math.max(0, Math.floor((player.flashlightBattery / 250) * 100))}%</div>
            <div style="margin-top:8px;">
                <div style="font-size:12px; color:#eee;">CANSAÇO:</div>
                <div style="width:100%; height:8px; background:#222; border-radius:4px; overflow:hidden;">
                    <div style="width:${exVal}%; height:100%; background:${exColor}; transition:width 0.3s;"></div>
                </div>
            </div>
            ${player.isParalyzed ? '<div style="color:#ffff00; font-weight:bold; margin-top:5px;">⚡ PARALISADO!</div>' : ''}
            ${player.isSlowed ? '<div style="color:#ff9900; font-weight:bold; margin-top:5px;">🌀 LENTO!</div>' : ''}
        `;
    }

    const il = document.getElementById('interaction-label');
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(interactiveObjects);
    if (hits.length > 0 && hits[0].distance < 7) {
        let name = "OBJETO";
        const o = hits[0].object;
        if (o.userData.type === 'loot') name = (o.userData.subType === 'ammo' ? "MUNIÇÃO" : "ARMADILHA");
        else if (o.parent && o.parent.userData && o.parent.userData.type === 'door') name = "PORTA";
        il.innerText = `PRESSIONE BOTÃO ESQUERDO PARA: ${name}`;
        il.style.opacity = "1";
    } else { il.style.opacity = "0"; }

    // Efeito de Sangue na Tela
    const bl = document.getElementById('blood-overlay');
    if (bl) {
        if (player.lives === 2) bl.style.opacity = "0.4";
        else if (player.lives === 1) bl.style.opacity = "0.8";
        else if (player.lives <= 0) bl.style.opacity = "1";
        else bl.style.opacity = "0";
    }
}

// --- LOGICA DE JOGO (MOVIMENTAÇÃO E FÍSICA) ---
function checkCollision(pX, pZ, radius = 0.55) {
    const minGridX = Math.floor((pX - 5) / GRID_SIZE);
    const maxGridX = Math.floor((pX + 5) / GRID_SIZE);
    const minGridZ = Math.floor((pZ - 5) / GRID_SIZE);
    const maxGridZ = Math.floor((pZ + 5) / GRID_SIZE);

    for (let gx = minGridX; gx <= maxGridX; gx++) {
        for (let gz = minGridZ; gz <= maxGridZ; gz++) {
            const key = `${gx}_${gz}`;
            const cell = collisionGrid.get(key);
            if (!cell) continue;
            for (let c of cell) {
                if (c.isTrap) continue; // IGNORES PLAYER COLLISION WITH TRAPS
                if (c.isDoor && c.doorObj && c.doorObj.userData.isOpen) continue;
                const dx = pX - c.x;
                const dz = pZ - c.z;
                const distSq = dx * dx + dz * dz;
                const minDist = radius + c.r;
                if (distSq < minDist * minDist) return true;
            }
        }
    }
    return false;
}
function handleMovement(delta) {
    if (!player.canMove || player.isParalyzed) return;

    // --- MODO VOO (CHEATS) ---
    if (window.isFlying) {
        const flySpeed = 50 * delta;
        const moveDir = new THREE.Vector3();
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);

        if (keys['KeyW']) moveDir.add(forward);
        if (keys['KeyS']) moveDir.sub(forward);
        if (keys['KeyA']) moveDir.sub(right);
        if (keys['KeyD']) moveDir.add(right);
        if (keys['Space']) player.model.position.y += flySpeed;
        if (keys['ShiftLeft']) player.model.position.y -= flySpeed;

        if (moveDir.length() > 0) {
            moveDir.normalize();
            player.model.position.add(moveDir.multiplyScalar(flySpeed));
        }
        return;
    }

    let wantsToSprint = (keys['ShiftLeft'] || keys['ShiftRight']) && (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']);
    if (player.staminaCooldown) if (clock.getElapsedTime() - player.coStartTime >= player.cooldownDuration) player.staminaCooldown = false;
    let canSprint = player.stamina > 0 && !player.staminaCooldown && !player.isAiming;
    player.isSprinting = wantsToSprint && canSprint;

    let baseSpeed = player.isSprinting ? 16.0 : 8.5;
    if (player.isAiming) baseSpeed *= 0.5; // Lento ao mirar
    const finalSpeed = (player.isSlowed ? baseSpeed * 0.4 : baseSpeed) * delta;
    const moveDir = new THREE.Vector3();
    if (config.isTopDown) { if (keys['KeyW']) moveDir.z -= 1; if (keys['KeyS']) moveDir.z += 1; if (keys['KeyA']) moveDir.x -= 1; if (keys['KeyD']) moveDir.x += 1; }
    else { const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw); const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw); if (keys['KeyW']) moveDir.add(forward); if (keys['KeyS']) moveDir.sub(forward); if (keys['KeyA']) moveDir.sub(right); if (keys['KeyD']) moveDir.add(right); }
    if (moveDir.length() > 0) {
        moveDir.normalize();
        const subSteps = 6;
        const sDist = finalSpeed / subSteps;
        for (let i = 0; i < subSteps; i++) {
            const oX = player.model.position.x;
            const oZ = player.model.position.z;
            player.model.position.x += moveDir.x * sDist;
            if (checkCollision(player.model.position.x, player.model.position.z, player.radius)) player.model.position.x = oX;
            player.model.position.z += moveDir.z * sDist;
            if (checkCollision(player.model.position.x, player.model.position.z, player.radius)) player.model.position.z = oZ;
        }
        if (player.isSprinting) {
            player.stamina -= 10 * delta;
            if (player.stamina <= 0) { player.stamina = 0; player.staminaCooldown = true; player.coStartTime = clock.getElapsedTime(); }
        }
    }
    if (!player.isSprinting && player.stamina < 100) { player.stamina += 22 * delta; if (player.stamina > 100) player.stamina = 100; }

    // Rastro de Sangue
    if (player.isBleeding && clock.getElapsedTime() - player.lastBloodTime > 1.5) {
        spawnBlood();
        player.lastBloodTime = clock.getElapsedTime();
    }
}

function animate() {
    requestAnimationFrame(animate);
    const d = clock.getDelta();

    // --- LÓGICA DE CLIMA E FASES ---
    if (!window.gameStarted) {
        updateAtmosphere(0);
        updatePlayer(d); // Manter a câmera posicionada no menu
        renderer.render(scene, camera);
        return;
    }

    if (gameStats.phase === "pre-game") {
        updateAtmosphere(0);
        gameStats.phase = "prep";
        clock.start();
        showCentralMessage(`NOITE ${gameStats.night}: Se prepare👿`, 5000);
    }
    else if (gameStats.phase === "prep") {
        gameStats.prepTimer -= d;
        let p = 1 - (gameStats.prepTimer / 180);
        updateAtmosphere(p);
        if (gameStats.prepTimer <= 0) {
            gameStats.phase = "transition";
            showCentralMessage("SOBREVIVA", 5000);
            setTimeout(() => {
                gameStats.phase = "survival";
                const numWolves = 12 + (gameStats.night * 2);
                for (let i = 0; i < numWolves; i++) spawnWolf();
                if (gameStats.night === 7) spawnWolf(true); // SPAWN ALFA
            }, 5000);
        }
    }
    else if (gameStats.phase === "survival") {
        // --- UIVO DE ALERTA ---
        if (player.isSprinting && (Date.now() - lastHowlTime) > 15000) {
            showCentralMessage("AUUUUUUU! 🐺 (ELES TE OUVIRAM!)", 3000);
            GameAudio.playHowl();
            lastHowlTime = Date.now();
            gameStats.wolves.forEach(w => w.userData.speed *= 1.5);
            setTimeout(() => gameStats.wolves.forEach(w => w.userData.speed /= 1.5), 5000);
        }
        gameStats.survivalTimer -= d;
        updateAtmosphere(1);
        if (player.canMove) handleWolves(d, Date.now());
        if (gameStats.survivalTimer <= 0 || gameStats.wolves.length === 0) {
            if (gameStats.night < 7) {
                gameStats.night++;
                resetPlayerStatus(true); // Cura e aumenta vida máxima
                gameStats.phase = "pre-game";
                gameStats.prepTimer = 180;
                gameStats.survivalTimer = 600;
                // Limpar lobos antigos
                gameStats.wolves.forEach(w => scene.remove(w));
                gameStats.wolves = [];
                showCentralMessage(`NOITE ${gameStats.night - 1} SOBREVIVIDA! ✨ NOVA VIDA MÁXIMA ALCANÇADA!`, 5000);
            } else {
                gameStats.phase = "ended";
                showCentralMessage("VOCÊ SOBREVIVEU ÀS 7 NOITES! 🏆", 15000);
            }
        }
    }

    updatePlayer(d); // Sempre atualizar a câmera para evitar que ela fique presa no chão (y=0)
    if (player.canMove) {
        handleMovement(d);
        handlePhysics(d);

        // Batimento Cardíaco baseado no Medo
        if (player.shakeIntensity > 0.01 && Math.random() < 0.02) {
            GameAudio.playHeartbeat();
        }

        // Tremor por Medo
        if (player.shakeIntensity > 0.01) {
            camera.rotation.x += (Math.random() - 0.5) * player.shakeIntensity;
            camera.rotation.y += (Math.random() - 0.5) * player.shakeIntensity;
            player.shakeIntensity *= 0.95; // Reduz gradualmente
        }

        // Timers de status
        if (player.paralysisTimer > 0) {
            player.paralysisTimer -= d;
            if (player.paralysisTimer <= 0) player.isParalyzed = false;
        }
        if (player.slowTimer > 0) {
            player.slowTimer -= d;
            if (player.slowTimer <= 0) player.isSlowed = false;
        }
        if (player.damageImmunityTimer > 0) {
            player.damageImmunityTimer -= d;
            if (player.damageImmunityTimer <= 0) player.isDamageImmune = false;
        }

        // --- SUAVIZAR RECUO DA ARMA E BALANÇO (BOB) ---
        if (player.weaponModel) {
            // Bobbing da arma ao andar/correr
            const bobMult = player.isSprinting ? 1.8 : 1.0;
            const bobSpeed = player.isSprinting ? 8 : 4;
            const time = clock.getElapsedTime() * bobSpeed;

            const bobX = Math.cos(time) * 0.02 * bobMult;
            const bobY = Math.sin(time * 2) * 0.02 * bobMult;

            player.weaponModel.position.x = THREE.MathUtils.lerp(player.weaponModel.position.x, 0.4 + bobX, 0.15);
            player.weaponModel.position.y = THREE.MathUtils.lerp(player.weaponModel.position.y, -0.4 + bobY, 0.15);
            player.weaponModel.position.z = THREE.MathUtils.lerp(player.weaponModel.position.z, -0.6, 0.15);
        }

        // --- SISTEMA ANTI-FUGA (EXAUSTÃO POR COVARDIA) ---
        if (gameStats.phase === "survival" && !player.isDead) {
            let isSafe = false;
            gameStats.cabins.forEach(c => { if (player.model.position.distanceTo(c.pos) < 35) isSafe = true; });

            if (isSafe) {
                player.cowardTimer = Math.max(0, player.cowardTimer - d * 20);
                player.exhaustion = Math.max(0, player.exhaustion - d * 10);
            } else if (player.isSprinting) {
                // Verificar se está em combate ou vendo lobos
                const seeingWolf = canSeeWolf();
                const recentlyActed = (Date.now() - player.lastActionTime) < 10000;

                if (!seeingWolf && !recentlyActed) {
                    player.cowardTimer += d;
                    // Escalar exaustão baseada no timer de 120s
                    player.exhaustion = (player.cowardTimer / 120) * 100;
                } else {
                    player.cowardTimer = Math.max(0, player.cowardTimer - d * 5);
                    player.exhaustion = Math.max(0, player.exhaustion - d * 2);
                }
            } else {
                player.cowardTimer = Math.max(0, player.cowardTimer - d * 2);
                player.exhaustion = Math.max(0, player.exhaustion - d * 1);
            }

            if (player.cowardTimer >= 120) {
                player.isDead = true;
                triggerExhaustionDeath();
            }
        }
    }

    updateDoors(d); // Animar as portas suavemente
    updateBloods();
    updateUI();
    renderer.render(scene, camera);
}
function createRadialWall(start, end, worldPos, isDoor = false, doorObj = null) {
    const startVec = new THREE.Vector2(start.x, start.z);
    const endVec = new THREE.Vector2(end.x, end.z);
    const dist = startVec.distanceTo(endVec);
    const step = 0.5;
    const numPoints = Math.ceil(dist / step);
    for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const pX = THREE.MathUtils.lerp(startVec.x, endVec.x, t) + worldPos.x;
        const pZ = THREE.MathUtils.lerp(startVec.y, endVec.y, t) + worldPos.z;
        addToGrid({ x: pX, z: pZ, r: 0.5, isDoor: isDoor, doorObj: doorObj });
    }
}
function setupOvergrownJungle() {
    const dummy = new THREE.Object3D();
    // Grama melhorada: agora são lâminas mais naturais
    const grassMesh = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0, 0.4, 2.5, 4),
        new THREE.MeshStandardMaterial({ color: 0x141814, roughness: 1 }),
        40000
    );
    let count = 0;
    for (let i = 0; i < 40000; i++) {
        const x = (Math.random() - 0.5) * 4000;
        const z = (Math.random() - 0.5) * 4000;
        if (Math.sqrt(x * x + (z - 30) * (z - 30)) < 40) continue;

        dummy.position.set(x, 1.0, z);
        dummy.rotation.y = Math.random() * Math.PI;
        dummy.scale.set(0.5 + Math.random(), 0.7 + Math.random() * 1.5, 0.5 + Math.random());
        dummy.updateMatrix();

        // Variação de cor sutil
        const greenVar = 0.5 + Math.random() * 0.5;
        grassMesh.setColorAt(count, new THREE.Color(0.1, 0.3 * greenVar, 0.1));

        grassMesh.setMatrixAt(count++, dummy.matrix);
    }
    grassMesh.instanceColor.needsUpdate = true;
    scene.add(grassMesh);
}
function updateAtmosphere(p) {
    if (window.isFullBright) {
        scene.background.set(0x7ec0ee); // Céu azul claro
        if (scene.fog) scene.fog.density = 0; // Remove neblina
        sunlight.intensity = 2.0;
        ambientLight.intensity = 2.0;
        if (hemiLight) hemiLight.intensity = 1.5;
        return;
    }

    // p vai de 0 (dia claro) a 1 (noite)
    const daySky = new THREE.Color(0x7ec0ee);
    const sunsetSky = new THREE.Color(0x526a8c);
    const nightSky = new THREE.Color(0x020305); // Noite bem escura e tensa

    let skyColor = new THREE.Color();
    if (p < 0.5) skyColor.lerpColors(daySky, sunsetSky, p * 2);
    else skyColor.lerpColors(sunsetSky, nightSky, (p - 0.5) * 2);

    scene.background = skyColor.clone(); // Garantir que o background mude corretamente
    if (scene.fog) {
        scene.fog.color.copy(skyColor);
        scene.fog.density = 0.005 * (1 - p) + 0.045 * p; // Neblina bem espessa à noite
    }

    sunlight.intensity = 1.2 * (1 - p);
    if (hemiLight) hemiLight.intensity = (0.4 * (1 - p)) + 0.01;
    ambientLight.intensity = (0.4 * (1 - p)) + 0.01;

    if (sunMesh) {
        const angle = (1 - p) * Math.PI * 0.5 + 0.5;
        const dist = 350;
        sunMesh.position.set(
            player.model.position.x + 80,
            Math.sin(angle) * dist,
            Math.cos(angle) * -dist + player.model.position.z
        );
        sunlight.position.copy(sunMesh.position);

        // Sol mais pálido (menos vermelho) ao se pôr
        const sunColor = new THREE.Color(0xffffff).lerp(new THREE.Color(0xf0e68c), p);
        sunMesh.material.color.copy(sunColor);
        if (sunLight) sunLight.color.copy(sunColor);

        sunMesh.scale.setScalar(4.0 + p * 2);
        sunMesh.visible = p < 0.98;
    }
}
function createPlayerModel() {
    const g = new THREE.Group();
    // Torso - Oculto para o jogador para não tampar a visão
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x2244aa }));
    torso.visible = false;
    g.add(torso);

    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0xffdbac }));
    h.position.y = 1.7;
    h.name = "playerHead";
    h.visible = false; // Cabeça também oculta em 1ª pessoa
    g.add(h);

    scene.add(g);
    player.model = g;
    player.model.position.set(0, 0, 0); // Spawna no centro da casa inicial segura
    updatePlayerVisibility(); // Esconde as partes do corpo na hora
}
function setupWeapon() {
    const gun = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.82), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    slide.position.y = 0.15;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.2), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    grip.position.set(0, -0.3, 0.3);
    grip.rotation.x = -0.3;
    gun.add(body, slide, grip);
    gun.scale.set(0.5, 0.5, 0.5);
    gun.position.set(0.4, -0.4, -0.6);
    camera.add(gun);
    player.weaponModel = gun;
}

// --- UTILITÁRIOS DE LUZ E CONTROLE ---
function setupFlashlight() {
    // Lanterna SpotLight (Feixe)
    player.flashlight = new THREE.SpotLight(0xffffff, 10000, 300, Math.PI / 6, 0.3, 1.2);
    player.flashlight.position.set(0.4, -0.3, 0);
    player.flashlight.target.position.set(0.4, -0.3, -20);
    camera.add(player.flashlight);
    camera.add(player.flashlight.target);

    // Pequena PointLight (Brilho ao redor do jogador)
    const bulb = new THREE.PointLight(0xffffee, 2, 8);
    bulb.position.set(0, 0, 0);
    player.flashlight.add(bulb);

    player.flashlight.visible = false;
}
function setupControls(canvas) {
    window.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (e.code === 'KeyF') config.isTopDown = !config.isTopDown;
        if (e.code === 'KeyL') {
            if (player.flashlightBattery > 0) {
                player.flashlightOn = !player.flashlightOn;
                if (player.flashlight) player.flashlight.visible = player.flashlightOn;
            }
        }
        if (e.code === 'KeyN' && window.cheatsEnabled) skipNight();
        if (e.code === 'KeyP' && window.cheatsEnabled) {
            player.totalAmmo += 100; player.medkits += 5; player.traps += 10; player.lives = 3;
            showCheatMessage("SUPRIMENTOS E VIDA RECEBIDOS! 📦❤️");
            GameAudio.playUIClick();
        }
        if (e.code === 'KeyV' && window.cheatsEnabled) {
            window.isFlying = !window.isFlying;
            updatePlayerVisibility();
            showCheatMessage(window.isFlying ? "VOO: ATIVADO 🦅" : "VOO: DESATIVADO");
            GameAudio.playUIClick();
        }
        if (e.code === 'KeyB' && window.cheatsEnabled) {
            toggleFullBright();
        }
        if (e.code === 'KeyR') reload();
        if (e.code === 'KeyH') useMedkit();
        if (e.code === 'KeyT') placeTrap();
        if (e.code === 'KeyK' && gameStats.phase === "prep") gameStats.prepTimer = 0;
        if (e.code === 'Space' && player.isGrounded) player.velocity.y = 12;
    });
    window.addEventListener('keyup', e => keys[e.code] = false);

    // Clique no canvas para garantir o foco e a trava do mouse
    canvas.addEventListener('click', () => {
        if (!player.canMove) canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        player.canMove = (document.pointerLockElement === canvas);
        const ls = document.getElementById('loading-screen');
        if (ls) ls.style.display = player.canMove ? 'none' : 'flex';

        // Se pegou o controle, garante que a fase de preparação comece
        if (player.canMove && gameStats.phase === "pre-game") {
            window.gameStarted = true;
        }
    });
    document.addEventListener('mousemove', e => {
        if (player.canMove) {
            const sens = player.sensitivity || 0.002;
            player.yaw -= e.movementX * sens;
            player.pitch -= e.movementY * sens;
            player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch));
        }
    });
    window.addEventListener('mousedown', e => {
        if (player.canMove) {
            if (e.button === 0 && !interact()) shoot();
            if (e.button === 2) player.isAiming = true;
        }
    });
    window.addEventListener('mouseup', e => {
        if (e.button === 2) player.isAiming = false;
    });
    window.addEventListener('contextmenu', e => e.preventDefault());
}

function handlePhysics(delta) {
    if (window.isFlying) {
        player.velocity.y = 0;
        return;
    }
    player.velocity.y -= 25 * delta;
    player.model.position.y += player.velocity.y * delta;
    if (player.model.position.y <= 0) {
        player.model.position.y = 0;
        player.velocity.y = 0;
        player.isGrounded = true;
    } else player.isGrounded = false;
}
function updatePlayer(delta) {
    if (!player.model) return;
    if (config.isTopDown) {
        camera.position.set(player.model.position.x, config.cameraHeight, player.model.position.z);
        camera.rotation.set(-Math.PI / 2, 0, 0);
    } else {
        const h = player.height || 1.7;
        camera.position.set(player.model.position.x, player.model.position.y + h, player.model.position.z);
        camera.rotation.set(player.pitch, player.yaw, 0);
    }
    player.model.rotation.y = player.yaw;

    // Efeito de FOV: Zoom ao mirar, Visão Ampla ao correr
    let targetFOV = 75;
    if (player.isAiming) targetFOV = 45;
    else if (player.isSprinting) targetFOV = 85;

    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.15);
    camera.updateProjectionMatrix();

    // Atualizar bateria da lanterna
    if (player.flashlightOn && player.flashlight) {
        player.flashlightBattery -= delta * 0.8;
        if (player.flashlightBattery <= 0) {
            player.flashlightBattery = 0;
            player.flashlightOn = false;
            player.flashlight.visible = false;
        }
    }
}
function interact() {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(interactiveObjects);
    if (hits.length > 0 && hits[0].distance < 7) {
        const o = hits[0].object;
        if (o.userData && o.userData.type === "loot") {
            const type = o.userData.subType;
            if (type === "ammo") player.totalAmmo += o.userData.amount;
            else if (type === "trap") player.traps += o.userData.amount;
            else if (type === "medkit") player.medkits += 1;

            showCentralMessage(`COLETOU: ${type.toUpperCase()}`, 2000);
            o.parent.remove(o);
            interactiveObjects = interactiveObjects.filter(x => x !== o);
            return true;
        }
        else if (o.parent && o.parent.userData && o.parent.userData.type === "door") {
            const door = o.parent;
            door.userData.isOpen = !door.userData.isOpen;
            door.userData.targetAngle = door.userData.isOpen ? -Math.PI / 1.5 : 0;
            return true;
        }
    }
    return false;
}

function placeTrap() {
    if (player.traps > 0) {
        player.traps--;
        const trap = new THREE.Group();
        const base = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.1, 8, 16), new THREE.MeshStandardMaterial({ color: 0x333333 }));
        base.rotation.x = Math.PI / 2;
        const glow = new THREE.PointLight(0xff0000, 2, 3); // Luz vermelha fraca para indicar onde está
        glow.position.y = 0.2;
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), new THREE.MeshStandardMaterial({ color: 0x555555 }));
        tooth.position.y = 0.2;
        trap.add(base, tooth, glow);

        // Spawn slightly in front of player
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
        trap.position.copy(player.model.position).add(forward.multiplyScalar(2));
        trap.position.y = 0.05;
        trap.userData = { type: "trap", active: true, x: trap.position.x, z: trap.position.z };
        scene.add(trap);
        gameStats.placedTraps.push(trap);
        addToGrid({ x: trap.position.x, z: trap.position.z, r: 1.5, isTrap: true, trapObj: trap });
    }
}

// Função de poça de sangue automática ao ser ferido removida para otimização, 
// o efeito agora é puramente visual via overlay de tela para maior clareza.

function updateBloods() {
    const now = clock.getElapsedTime();
    gameStats.bloodPools = gameStats.bloodPools.filter(b => {
        if (now - b.userData.spawnTime > 30) {
            scene.remove(b);
            return false;
        }
        return true;
    });
}

function applyDamage(amt) {
    if (player.isDamageImmune) return; // Proteção contra spam de dano

    player.lives -= amt;
    player.isBleeding = true;

    // Inicia Imunidade de 4 segundos
    player.isDamageImmune = true;
    player.damageImmunityTimer = 4.0;

    if (player.lives <= 0) {
        gameStats.phase = "ended";
        showCentralMessage("VOCÊ MORREU... 🐺<br><span style='font-size:30px'>REINICIANDO EM 10s...</span>", 10000);
        setTimeout(() => window.location.reload(), 10000);
    } else {
        showCentralMessage("VOCÊ FOI FERIDO! (4s DE IMUNIDADE 🛡️)", 3000);
        // Efeito visual na tela
        const blood = document.getElementById('blood-overlay');
        if (blood) {
            blood.style.opacity = '1';
            setTimeout(() => { if (!player.isBleeding) blood.style.opacity = '0'; }, 2000);
        }
    }
}

function updateDoors(delta) {
    gameStats.doors.forEach(door => {
        const speed = 5 * delta;
        const diff = door.userData.targetAngle - door.userData.currentAngle;
        if (Math.abs(diff) > 0.01) {
            door.userData.currentAngle += diff * speed;
            door.rotation.y = door.userData.currentAngle;
        }
    });
}
function shoot() {
    if (player.magAmmo > 0 && !player.reloading) {
        player.magAmmo--;
        GameAudio.playShoot();

        // Recuo e Inaccuracy (Reduzidos ao mirar)
        let inaccuracy = player.shakeIntensity;
        if (player.isAiming) inaccuracy *= 0.4; // 60% mais preciso ao mirar

        if (player.weaponModel) {
            // Aplicar coice inicial (Deslocamento)
            player.weaponModel.position.z += 0.2;
            player.weaponModel.position.y += 0.1;

            // Limitar recuo máximo para não sumir da tela caso atire muito rápido
            player.weaponModel.position.z = Math.min(player.weaponModel.position.z, 0.2);
            player.weaponModel.position.y = Math.min(player.weaponModel.position.y, 0);
        }

        const flash = new THREE.PointLight(0xffaa00, 5, 5);
        flash.position.set(0.4, -0.2, -1.2).applyMatrix4(camera.matrixWorld);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 50);

        // PRECISÃO 100%: Sem nenhum desvio para teste de imortalidade
        raycaster.setFromCamera({ x: 0, y: 0 }, camera);

        // INTERSEÇÃO TOTAL: Checa tudo na cena para garantir que nada bloqueie
        const hits = raycaster.intersectObjects(scene.children, true);

        let targetWolf = null;
        let hitPoint = null;

        for (let i = 0; i < hits.length; i++) {
            const obj = hits[i].object;

            // Ignorar o próprio jogador e sua arma
            if (obj === player.model || (player.weaponModel && player.weaponModel.getObjectsByProperty('uuid', obj.uuid).length > 0)) continue;

            // Se bater no chão primeiro, para o tiro
            if (obj === floor) {
                hitPoint = hits[i].point;
                break;
            }

            // Se bater em qualquer parte de um lobo ou sua hitbox
            let root = obj.userData.hpOwner;
            if (!root) {
                let p = obj.parent;
                while (p && !root) {
                    if (p.userData && p.userData.hp !== undefined) root = p;
                    p = p.parent;
                }
            }

            if (root && root.userData && root.userData.hp !== undefined) {
                targetWolf = root;
                hitPoint = hits[i].point;
                break;
            }
        }

        if (hitPoint) {
            // Efeito visual no ponto de impacto
            const impact = new THREE.Mesh(new THREE.SphereGeometry(0.15), new THREE.MeshBasicMaterial({ color: targetWolf ? 0xff0000 : 0xffffff }));
            impact.position.copy(hitPoint);
            scene.add(impact);
            setTimeout(() => scene.remove(impact), 150);
        }

        if (targetWolf && !targetWolf.userData.dead) {
            // DANO PADRÃO: 20 por bala
            let damage = 20;
            if (gameStats.night >= 5 && targetWolf.userData.isImmune) damage = 4;

            targetWolf.userData.hp -= damage;

            // Feedback visual: Piscar vermelho intenso
            targetWolf.traverse(c => {
                if (c instanceof THREE.Mesh) {
                    if (!c.userData.oldMat) c.userData.oldMat = c.material;
                    c.material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                    setTimeout(() => { if (c.userData.oldMat) c.material = c.userData.oldMat; }, 150);
                }
            });

            if (targetWolf.userData.hp <= 0) {
                targetWolf.userData.dead = true;

                // Noite 7: Alfa Invoca
                if (targetWolf.userData.isAlpha && targetWolf.userData.hp <= targetWolf.userData.maxHp * 0.5 && targetWolf.userData.hp <= targetWolf.userData.lastInvokeHp - 7) {
                    targetWolf.userData.lastInvokeHp = targetWolf.userData.hp;
                    showCentralMessage("O ALFA CHAMOU A ALCATÉIA! 🐺🐺", 3000);
                    GameAudio.playHowl();
                    for (let i = 0; i < 3; i++) spawnWolf();
                }

                // Remover após animação de morte
                setTimeout(() => {
                    scene.remove(targetWolf);
                    gameStats.wolves = gameStats.wolves.filter(x => x !== targetWolf);
                    targetWolf.traverse(child => {
                        if (child instanceof THREE.Mesh) {
                            damageableObjects = damageableObjects.filter(ax => ax !== child);
                        }
                    });
                }, 2000);
            }

            player.lastActionTime = Date.now();
            player.cowardTimer = 0;
        }
    }
}
function reload() {
    if (!player.reloading && player.magAmmo < player.magSize && player.totalAmmo > 0) {
        player.reloading = true;
        showCentralMessage("RECARREGANDO...", 3500);
        setTimeout(() => {
            const needed = player.magSize - player.magAmmo;
            const toReload = Math.min(needed, player.totalAmmo);
            player.magAmmo += toReload;
            player.totalAmmo -= toReload;
            player.reloading = false;
        }, 4000);
    } else if (player.totalAmmo <= 0 && player.magAmmo < player.magSize) {
        showCentralMessage("SEM MUNIÇÃO EXTRA!", 2000);
    }
}
function handleWolves(delta, now) {
    const night = gameStats.night;
    gameStats.wolves.forEach(w => {
        if (w.userData.trapped) {
            w.userData.trapTime -= delta;
            if (w.userData.trapTime <= 0) w.userData.trapped = false;
            return;
        }

        const d = new THREE.Vector3().subVectors(player.model.position, w.position);
        let dist = d.length();

        // --- SISTEMA DE MEDO (TREMOR) ---
        if (dist < 40) {
            // Intensidade aumentada para dificultar mira (0.15)
            player.shakeIntensity = Math.max(player.shakeIntensity, (1 - dist / 40) * 0.15);
        }

        // --- NOITE 5: IMUNIDADE (REDUÇÃO DE DANO) ---
        if (night >= 5) {
            w.userData.immunityCooldown -= delta;
            if (w.userData.isImmune && w.userData.immunityCooldown <= 0) w.userData.isImmune = false;
            // Chance reduzida para 0.3% por frame
            if (!w.userData.isImmune && Math.random() < 0.003) {
                w.userData.isImmune = true;
                w.userData.immunityCooldown = 2.0; // Duração reduzida para 2 segundos
            }
        }

        // --- NOITE 1: DASH ---
        let currentSpeed = w.userData.speed;
        w.userData.dashCooldown -= delta;
        if (night >= 1 && dist < 25 && w.userData.dashCooldown <= 0) {
            currentSpeed *= 2.5;
            if (Math.random() < 0.01) w.userData.dashCooldown = 6;
        }

        // --- ANIMAÇÃO PROCEDURAL ---
        const actualSpeed = currentSpeed || w.userData.speed;
        w.userData.bobPhase += delta * actualSpeed * 0.5;
        const bob = Math.sin(w.userData.bobPhase) * 0.15;

        // Balanço do tronco e cabeça (Baseado na altura original do modelo)
        w.children.forEach(child => {
            // Se for o tronco ou tórax, aplicamos o bob na posição básica dele
            if (child instanceof THREE.Mesh) {
                if (child.geometry.type === "BoxGeometry") {
                    // Resetamos levemente para a altura padrão e somamos o bob
                    if (child.position.y > 1.0) {
                        const s = w.userData.size || 1.2;
                        const baseHeight = child === w.children[0] ? (1.2 * s) : (1.8 * s);
                        child.position.y = baseHeight + bob;
                    }
                }
            }

            // Balanço dos braços durante a corrida
            if (child instanceof THREE.Group && child.children.length > 2) {
                child.rotation.x = Math.sin(w.userData.bobPhase) * 0.5;
            }
        });

        // Verificar Armadilhas via Grid (Alta Performance)
        const gKey = getGridKey(w.position.x, w.position.z);
        const cellItems = collisionGrid.get(gKey);
        if (cellItems) {
            cellItems.forEach(item => {
                if (item.isTrap && item.trapObj.userData.active && w.position.distanceTo(item.trapObj.position) < 2) {
                    w.userData.trapped = true;
                    w.userData.trapTime = 5;
                    w.userData.hp -= 1; // Tirar 1 de vida conforme pedido
                    item.trapObj.userData.active = false;
                    scene.remove(item.trapObj);

                    // Feedback visual de dano pela trap
                    w.traverse(c => {
                        if (c instanceof THREE.Mesh) {
                            if (!c.userData.oldMat) c.userData.oldMat = c.material;
                            c.material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                            setTimeout(() => { if (c.userData.oldMat) c.material = c.userData.oldMat; }, 150);
                        }
                    });

                    // Se a trap matar o lobo
                    if (w.userData.hp <= 0 && !w.userData.dead) {
                        w.userData.dead = true;
                        setTimeout(() => {
                            scene.remove(w);
                            gameStats.wolves = gameStats.wolves.filter(x => x !== w);
                            w.traverse(child => {
                                if (child instanceof THREE.Mesh) {
                                    damageableObjects = damageableObjects.filter(ax => ax !== child);
                                }
                            });
                        }, 2000);
                    }
                }
            });
        }

        d.y = 0; d.normalize();
        if (player.flashlightOn && dist < 45) currentSpeed *= 1.5;

        w.lookAt(player.model.position.x, 0, player.model.position.z);

        // --- ATAQUE A PORTAS E CABANAS ---
        let isAttackingBuilding = false;

        // Portas (Noite 1+)
        gameStats.doors.forEach(door => {
            if (w.position.distanceTo(door.parent.position) < 6) {
                isAttackingBuilding = true;
                if (now - door.userData.lastAttackTime > 2000) {
                    const dmg = 4 + (night * 1.5);
                    door.userData.hp -= dmg;
                    door.userData.lastAttackTime = now;
                    if (door.userData.hp <= 0) {
                        scene.remove(door);
                        gameStats.doors = gameStats.doors.filter(x => x !== door);
                    }
                }
            }
        });

        // Cabanas (Noite 5+)
        if (night >= 5) {
            gameStats.cabins.forEach(cabin => {
                if (w.position.distanceTo(cabin.pos) < 12) {
                    isAttackingBuilding = true;
                    const wolvesNear = gameStats.wolves.filter(wolf => wolf.position.distanceTo(cabin.pos) < 12).length;
                    const baseSecs = 44;
                    const secsToDestroy = Math.max(5, baseSecs - (wolvesNear * 4));
                    if (now - cabin.lastAttackTime > 1000) {
                        cabin.hp -= (100 / secsToDestroy);
                        cabin.lastAttackTime = now;
                        if (cabin.hp <= 0) {
                            scene.remove(cabin.model);
                            gameStats.cabins = gameStats.cabins.filter(c => c !== cabin);
                        }
                    }
                }
            });
        }

        if (w.userData.dead) {
            // Se estiver morto, apenas tomba pro lado
            w.rotation.z = THREE.MathUtils.lerp(w.rotation.z, Math.PI / 2, 0.1);
            return;
        }

        if (dist > 3.5 && !isAttackingBuilding) {
            const wolfRadius = 1.0;
            const subSteps = 4;
            const stepDist = (currentSpeed * delta) / subSteps;
            for (let i = 0; i < subSteps; i++) {
                const oldX = w.position.x;
                const oldZ = w.position.z;
                w.position.x += d.x * stepDist;
                if (checkCollision(w.position.x, w.position.z, wolfRadius)) w.position.x = oldX;
                w.position.z += d.z * stepDist;
                if (checkCollision(w.position.x, w.position.z, wolfRadius)) w.position.z = oldZ;
            }
        }
        else if (dist <= 3.5 && now - w.userData.lastAttack > 1200) {
            // --- HABILIDADES DE COMBATE ---

            // Noite 6: Roubar e Descarregar
            if (night >= 6) {
                if (player.magAmmo > 0) { player.magAmmo = 0; showCentralMessage("ARMA DESCARREGADA! ⚠️", 2000); }
                if (Math.random() < 0.5 && player.traps > 0) { player.traps--; showCentralMessage("ARMADILHA ROUBADA! 🎒", 2000); }
            }

            // Noite 2-3: Jogar Player
            if (night >= 2 && player.isBleeding) {
                const throwDir = new THREE.Vector3().subVectors(player.model.position, w.position).normalize();
                player.model.position.add(throwDir.multiplyScalar(20));
                player.isSlowed = true;
                player.slowTimer = 4;
                showCentralMessage("VOCÊ FOI JOGADO! 🌀", 2000);

                if (night >= 3) {
                    applyDamage(1);
                    if (Math.random() < (1 / 15)) {
                        player.isParalyzed = true;
                        player.paralysisTimer = 5;
                        showCentralMessage("PARALISADO PELO CHOQUE! ⚡", 5000);
                    }
                }
            } else {
                applyDamage(1);
            }
            w.userData.lastAttack = now;
        }
    });
}
function createHolePit(x, z) { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 10, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x000000, side: THREE.BackSide }))); g.children[0].position.y = -5; g.position.set(x, 0, z); scene.add(g); }
function createCorpse(x, z) {
    const g = new THREE.Group();
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xa09080 }); // Pele pálida cadavérica
    const bloodMat = new THREE.MeshStandardMaterial({ color: 0x550000, transparent: true, opacity: 0.85 });

    // 60% de chance de estar despedaçado
    const isDismembered = Math.random() > 0.4;

    // Definição das partes do corpo (proporções básicas)
    const parts = [
        { name: "head", g: [0.35, 0.35, 0.35], p: [0, 0.1, -0.7], r: [0, 0, 0] },
        { name: "torso", g: [0.6, 0.9, 0.3], p: [0, 0.1, 0], r: [0, 0, 0] },
        { name: "armL", g: [0.18, 0.7, 0.18], p: [-0.4, 0.1, -0.2], r: [0, 0, 0.5] },
        { name: "armR", g: [0.18, 0.7, 0.18], p: [0.4, 0.1, -0.2], r: [0, 0, -0.5] },
        { name: "legL", g: [0.22, 0.8, 0.22], p: [-0.2, 0.1, 0.7], r: [0.1, 0, 0.1] },
        { name: "legR", g: [0.22, 0.8, 0.22], p: [0.2, 0.1, 0.7], r: [0.1, 0, -0.1] }
    ];

    parts.forEach(p => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...p.g), skinMat);
        if (isDismembered) {
            // Espalhar partes num raio de 4 metros (Despedaçado)
            mesh.position.set((Math.random() - 0.5) * 4, 0.1, (Math.random() - 0.5) * 4);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

            // Poça de sangue individual sob cada membro
            const b = new THREE.Mesh(new THREE.CircleGeometry(0.4 + Math.random(), 6), bloodMat);
            b.rotation.x = -Math.PI / 2;
            b.position.set(mesh.position.x, -0.08, mesh.position.z);
            g.add(b);
        } else {
            // Corpo Inteiro: Pose deitada
            mesh.position.set(...p.p);
            mesh.rotation.set(Math.PI / 2, 0, p.r[2]);
        }
        g.add(mesh);
    });

    if (!isDismembered) {
        // Poça de sangue grande para corpos inteiros
        const pool = new THREE.Mesh(new THREE.CircleGeometry(2.2, 8), bloodMat);
        pool.rotation.x = -Math.PI / 2;
        pool.position.y = -0.08;
        g.add(pool);
        // Rotação aleatória para o corpo não ficar sempre na mesma direção
        g.rotation.y = Math.random() * Math.PI * 2;
    }

    g.position.set(x, 0.1, z);
    scene.add(g);
}

function useMedkit() {
    if (player.medkits > 0 && player.lives < player.maxLives) {
        player.medkits--;
        player.lives++;
        player.isBleeding = false;
        showCentralMessage("VOCÊ USOU UM KIT MÉDICO (+1 ❤️)", 3000);
        GameAudio.playUIClick();
    } else if (player.lives >= player.maxLives) {
        showCentralMessage("VIDA JÁ ESTÁ NO MÁXIMO!", 2000);
    } else {
        showCentralMessage("SEM KITS MÉDICOS!", 2000);
    }
}

function skipNight() {
    if (gameStats.night < 7) {
        gameStats.wolves.forEach(w => scene.remove(w));
        gameStats.wolves = [];
        gameStats.night++;
        resetPlayerStatus(true);
        gameStats.phase = "pre-game";
        gameStats.prepTimer = 180;
        gameStats.survivalTimer = 600;
        showCheatMessage(`AVANÇOU PARA NOITE ${gameStats.night} [VIDA AUMENTADA]`);
        GameAudio.playHowl();
    }
}

function resetPlayerStatus(isNewNight = false) {
    if (isNewNight) player.maxLives++;
    player.lives = player.maxLives;
    player.stamina = player.maxStamina;
    player.isBleeding = false;
    player.isParalyzed = false;
    player.paralysisTimer = 0;
    player.isDamageImmune = false;
    player.damageImmunityTimer = 0;
    player.exhaustion = 0;
    player.shakeIntensity = 0;

    // Feedback visual do sangue sumindo
    const blood = document.getElementById('blood-overlay');
    if (blood) blood.style.opacity = '0';
}

function toggleFullBright() {
    window.isFullBright = !window.isFullBright;
    if (window.isFullBright) {
        if (scene.fog) scene.fog.density = 0;
        if (ambientLight) ambientLight.intensity = 2.0;
        if (hemiLight) hemiLight.intensity = 1.5;
        showCheatMessage("MODO CLARO: ATIVADO ☀️");
    } else {
        // Retorna aos valores originais de neblina (se existir)
        if (scene.fog) scene.fog.density = 0.035;
        if (ambientLight) ambientLight.intensity = 0.4;
        if (hemiLight) hemiLight.intensity = 0.3;
        showCheatMessage("MODO CLARO: DESATIVADO 🌑");
    }
    GameAudio.playUIClick();
}

function updatePlayerVisibility() {
    if (!player.model) return;
    // O corpo e cabeça são sempre invisíveis em 1ª pessoa
    player.model.children.forEach(child => child.visible = false);

    // A arma só some no modo de voo
    if (player.weaponModel) {
        player.weaponModel.visible = !window.isFlying;
    }
}

window.onload = init;
