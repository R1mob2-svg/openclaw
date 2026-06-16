const admin = require('firebase-admin');
const { SkillRegistry } = require('./modules/skill_foundry/skillRegistry');
const FirestoreAdapter = require('./src/storage/firestoreAdapter').FirestoreAdapter || require('./src/storage/firestoreAdapter');

async function seed() {
  console.log('Seeding skills to Firestore...');
  
  const storage = require('./src/storage/firestoreAdapter');

  const registry = new SkillRegistry(storage);
  
  const echoSkill = require('./modules/skill_foundry/skills/echo_receipt_skill_v1');
  const ventureSkill = require('./modules/skill_foundry/skills/venture_lead_record_mirror_v1');

  let res1 = await registry.registerSkill(echoSkill.manifest);
  console.log('Echo skill registered:', res1);

  let res2 = await registry.registerSkill(ventureSkill.manifest);
  console.log('Venture skill registered:', res2);

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch(console.error);
