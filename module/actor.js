const ATTACK_ROLL_CARD_TEMPLATE = "systems/morkborg/templates/attack-roll-card.html";
const DEFEND_ROLL_CARD_TEMPLATE = "systems/morkborg/templates/defend-roll-card.html";
const MORALE_ROLL_CARD_TEMPLATE = "systems/morkborg/templates/morale-roll-card.html";
const REACTION_ROLL_CARD_TEMPLATE = "systems/morkborg/templates/reaction-roll-card.html";
const TEST_ABILITY_ROLL_CARD_TEMPLATE = "systems/morkborg/templates/test-ability-roll-card.html";

/**
 * @extends {Actor}
 */
export class MBActor extends Actor {
  /** @override */
  static async create(data, options={}) {
    data.token = data.token || {};
    if (data.type === "character") {
      mergeObject(data.token, {
        vision: true,
        dimSight: 30,
        brightSight: 0,
        actorLink: true,
        disposition: 1
      }, {overwrite: false});
    }
    return super.create(data, options);
  }

  /** @override */
  prepareData() {
    super.prepareData();
  }

  /** @override */
  getRollData() {
    const data = super.getRollData();
    return data;
  }

  _firstEquipped(itemType) {
    for (const item of this.data.items) {
      if (item.type === itemType && item.data.equipped) {
        return item;
      }
    }
    return undefined;
  }

  equippedArmor() {
    return this._firstEquipped("armor");
  }

  equippedShield() {
    return this._firstEquipped("shield");
  }

  normalCarryingCapacity() {
    return this.data.data.abilities.strength.value + 8;
  }

  maxCarryingCapacity() {
    return 2 * this.normalCarryingCapacity();
  }

  carryingAmount() {
    let total = 0;
    for (const item of this.data.items) {
      if (CONFIG.MB.itemEquipmentTypes.includes(item.type) && item.data.carryWeight) {
        total += item.data.carryWeight;
      }
    }
    return total;
  }

  isEncumbered() {
    return this.carryingAmount() > this.normalCarryingCapacity();
  }

  defenseDRModifier() {
    
  }

  async _testAbility(ability, abilityKey, drModifiers) {
    let abilityRoll = new Roll(`1d20+@abilities.${ability}.value`, this.getRollData());
    abilityRoll.evaluate();
    const rollResult = {
      abilityKey: abilityKey,
      abilityRoll,
      drModifiers,
    }
    const html = await renderTemplate(TEST_ABILITY_ROLL_CARD_TEMPLATE, rollResult)
    ChatMessage.create({
      content : html,
      sound : CONFIG.sounds.dice,
      speaker : ChatMessage.getSpeaker({actor: this}),
    });
  }

  async testStrength() {
    let drModifiers = [];
    if (this.isEncumbered()) {
      drModifiers.push(`${game.i18n.localize('MB.Encumbered')}: ${game.i18n.localize('MB.DR')} +2`);
    }
    return this._testAbility("strength", "MB.AbilityStrength", drModifiers);
  }

  async testAgility() {
    let drModifiers = [];
    const armor = this.equippedArmor();
    if (armor) {
      const armorTier = CONFIG.MB.armorTiers[armor.data.maxTier];
      if (armorTier.agilityModifier) {
        drModifiers.push(`${armor.name}: ${game.i18n.localize('MB.DR')} +${armorTier.agilityModifier}`);
      }
    }
    if (this.isEncumbered()) {
      drModifiers.push(`${game.i18n.localize('MB.Encumbered')}: ${game.i18n.localize('MB.DR')} +2`);
    }
    return this._testAbility("agility", "MB.AbilityAgility", drModifiers);
  }

  async testPresence() {
    return this._testAbility("presence", "MB.AbilityPresence", null);
  }

  async testToughness() {
    return this._testAbility("agility", "MB.AbilityToughness", null);
  }

  /**
   * Attack!
   */
  async attack(itemId) {
    let attackDR = await this.getFlag(CONFIG.MB.flagScope, CONFIG.MB.flags.ATTACK_DR);
    if (!attackDR) {
      attackDR = 12;  // default
    }
    const targetArmor = await this.getFlag(CONFIG.MB.flagScope, CONFIG.MB.flags.TARGET_ARMOR);    
    const template = "systems/morkborg/templates/attack-dialog.html";
    let dialogData = {
      attackDR,
      config: CONFIG.MorkBorg,
      itemId,
      targetArmor
    };
    const html = await renderTemplate(template, dialogData);
    return new Promise(resolve => {
      new Dialog({
         title: game.i18n.localize('MB.Attack'),
         content: html,
         buttons: {
            roll: {
              icon: '<i class="fas fa-dice-d20"></i>',
              label: game.i18n.localize('MB.Roll'),
              // callback: html => resolve(_createItem(this.actor, html[0].querySelector("form")))
              callback: html => this._attackDialogCallback(html)
            },
         },
         default: "roll",
         close: () => resolve(null)
        }).render(true);
    });
  }

  /**
   * Callback from attack dialog.
   */
  async _attackDialogCallback(html) {
    const form = html[0].querySelector("form");
    const itemId = form.itemid.value;
    const attackDR = parseInt(form.attackdr.value);
    const targetArmor = form.targetarmor.value;
    if (!itemId || !attackDR) {
      // TODO: prevent form submit via required fields
      return;
    }
    await this.setFlag(CONFIG.MB.flagScope, CONFIG.MB.flags.ATTACK_DR, attackDR);
    await this.setFlag(CONFIG.MB.flagScope, CONFIG.MB.flags.TARGET_ARMOR, targetArmor);
    this._rollAttack(itemId, attackDR, targetArmor);
  }

  /**
   * Do the actual attack rolls and resolution.
   */
  async _rollAttack(itemId, attackDR, targetArmor) {
    const item = this.getOwnedItem(itemId);
    const itemRollData = item.getRollData();
    const actorRollData = this.getRollData();

    // roll 1: attack
    const isRanged = itemRollData.weaponType === 'ranged';
    // ranged weapons use agility; melee weapons use strength
    const ability = isRanged ? 'agility' : 'strength';
    let attackRoll = new Roll(`d20+@abilities.${ability}.value`, actorRollData);
    attackRoll.evaluate();
    await game.dice3d.showForRoll(attackRoll);  // show roll for DiceSoNice
    const d20Result = attackRoll.results[0];
    const isFumble = (d20Result === 1);
    const isCrit = (d20Result === 20);

    let attackOutcome = null;
    let damageRoll = null;
    let targetArmorRoll = null;
    let takeDamage = null;
    if (attackRoll.total >= attackDR) {
      // HIT!!!
      attackOutcome = game.i18n.localize(isCrit ? 'MB.AttackCritText' : 'MB.Hit');
      // roll 2: damage
      const damageFormula = isCrit ? "@damageDie * 2" : "@damageDie";
      damageRoll = new Roll(damageFormula, itemRollData);
      damageRoll.evaluate();
      const p1 = game.dice3d.showForRoll(damageRoll);  // show roll for DiceSoNice
      let damage = damageRoll.total;
      // roll 3: target damage reduction
      if (targetArmor) {
        targetArmorRoll = new Roll(targetArmor, {});
        targetArmorRoll.evaluate();
        const p2 = game.dice3d.showForRoll(targetArmorRoll);  // show roll for DiceSoNice
        damage = Math.max(damage - targetArmorRoll.total, 0);
        await Promise.allSettled([Promise.resolve(p1), Promise.resolve(p2)])
      } else {
        await Promise.allSettled([Promise.resolve(p1)])
      }
      takeDamage = `${game.i18n.localize('MB.Take')} ${damage} ${game.i18n.localize('MB.Damage')}`
    } else {
      // MISS!!!
      attackOutcome = game.i18n.localize(isFumble ? 'MB.AttackFumbleText' : 'MB.Miss');
    }

    // TODO: decide key in handlebars/template?
    const weaponTypeKey = isRanged ? 'MB.WeaponTypeRanged' : 'MB.WeaponTypeMelee';
    const rollResult = {
      actor: this,
      attackRoll,
      attackOutcome,
      damageRoll,      
      items: [item],
      takeDamage,
      targetArmorRoll,
      weaponTypeKey
    };
    await this._renderAttackRollCard(rollResult);
  }

  /**
   * Show attack rolls/result in a chat roll card.
   */
  async _renderAttackRollCard(rollResult) {
    const html = await renderTemplate(ATTACK_ROLL_CARD_TEMPLATE, rollResult)
    ChatMessage.create({
      content : html,
      sound : CONFIG.sounds.dice,
      speaker : ChatMessage.getSpeaker({actor: this}),
    });
  }

  /**
   * Defend!
   */
  async defend() {
    // look up any previous DR or incoming attack value
    let defendDR = await this.getFlag(CONFIG.MB.flagScope, CONFIG.MB.flags.DEFEND_DR);
    if (!defendDR) {
      defendDR = 12;  // default
    }
    const incomingAttack = await this.getFlag(CONFIG.MB.flagScope, CONFIG.MB.flags.INCOMING_ATTACK);
    const template = "systems/morkborg/templates/defend-dialog.html";

    const armor = this.equippedArmor();
    let drModifiers = [];
    if (armor) {
      // armor defense adjustment is based on its max tier, not current
      // TODO: maxTier is getting stored as a string
      const maxTier = parseInt(armor.data.maxTier);
      const defenseModifier = CONFIG.MB.armorTiers[maxTier].defenseModifier;
      if (defenseModifier) { 
        drModifiers.push(`${armor.name}: ${game.i18n.localize('MB.DR')} +${defenseModifier}`);       
      }
    }
    if (this.isEncumbered()) {
      drModifiers.push(`${game.i18n.localize('MB.Encumbered')}: ${game.i18n.localize('MB.DR')} +2`);
    }

    let dialogData = {
      defendDR,
      drModifiers,
      incomingAttack,
    };
    const html = await renderTemplate(template, dialogData);

    return new Promise(resolve => {
      new Dialog({
         title: game.i18n.localize('MB.Defend'),
         content: html,
         buttons: {
            roll: {
              icon: '<i class="fas fa-dice-d20"></i>',
              label: game.i18n.localize('MB.Roll'),
              callback: html => this._defendDialogCallback(html)
            },
         },
         default: "roll",
         render: (html) => {
          html.find("input[name='defensebasedr']").on("change", this._onDefenseBaseDRChange.bind(this));
          html.find("input[name='defensebasedr']").trigger("change");
        },
         close: () => resolve(null)
        }).render(true);
    });
  }

  _onDefenseBaseDRChange(event) {
    event.preventDefault();
    const baseInput = $(event.currentTarget);
    let drModifier = 0;
    const armor = this.equippedArmor();
    if (armor) {
      // TODO: maxTier is getting stored as a string
      const maxTier = parseInt(armor.data.maxTier);
      const defenseModifier = CONFIG.MB.armorTiers[maxTier].defenseModifier;
      if (defenseModifier) { 
        drModifier += defenseModifier;
      }
    }
    if (this.isEncumbered()) {
      drModifier += 2;
    }
    const modifiedDr = parseInt(baseInput[0].value) + drModifier;
    // TODO: this is a fragile way to find the other input field
    const modifiedInput = baseInput.parent().parent().find("input[name='defensemodifieddr']");
    modifiedInput.val(modifiedDr.toString());
  }

  /**
   * Callback from defend dialog.
   */
  async _defendDialogCallback(html) {
    const form = html[0].querySelector("form");
    const baseDR = parseInt(form.defensebasedr.value);
    const modifiedDR = parseInt(form.defensemodifieddr.value);
    const incomingAttack = form.incomingattack.value;
    if (!baseDR || !modifiedDR || !incomingAttack) {
      // TODO: prevent dialog/form submission w/ required field(s)
      return;
    }
    await this.setFlag(CONFIG.MB.flagScope, CONFIG.MB.flags.DEFEND_DR, baseDR);
    await this.setFlag(CONFIG.MB.flagScope, CONFIG.MB.flags.INCOMING_ATTACK, incomingAttack);
    this._rollDefend(modifiedDR, incomingAttack);
  }

  /**
   * Do the actual defend rolls and resolution.
   */
  async _rollDefend(defendDR, incomingAttack) {
    const rollData = this.getRollData();
    const armor = this.equippedArmor();
    const shield = this.equippedShield();

    let armorDefenseAdjustment = 0;
    if (armor) {
    }

    // roll 1: defend
    let defendRoll = new Roll("d20+@abilities.agility.value", rollData);
    defendRoll.evaluate();
    await game.dice3d.showForRoll(defendRoll);  // show roll for DiceSoNice
    const d20Result = defendRoll.results[0];
    const isFumble = (d20Result === 1);
    const isCrit = (d20Result === 20);

    let items = [];
    let damageRoll = null;
    let armorRoll = null;
    let defendOutcome = null;
    let takeDamage = null;

    if (isCrit) {
      // critical success
      defendOutcome = game.i18n.localize('MB.DefendCritText');
    } else if (defendRoll.total >= defendDR) {
      // success
      defendOutcome = game.i18n.localize('MB.Dodge');
    } else {
      // failure
      if (isFumble) {
        defendOutcome = game.i18n.localize('MB.DefendFumbleText');
      } else {
        defendOutcome = game.i18n.localize('MB.Hit');
      }

      // roll 2: incoming damage
      let damageFormula = incomingAttack;
      if (isFumble) {
        damageFormula += " * 2";
      }
      damageRoll = new Roll(damageFormula, {});
      damageRoll.evaluate();
      const p1 = game.dice3d.showForRoll(damageRoll);  // show roll for DiceSoNice
      let damage = damageRoll.total;

      // roll 3: damage reduction from equipped armor and shield
      let damageReductionDie = "";
      if (armor) {
        damageReductionDie = CONFIG.MB.armorTiers[armor.data.currentTier].damageReductionDie;
        items.push(armor);
      }    
      if (shield) {
        damageReductionDie += "+1";
        items.push(shield);
      }
      if (damageReductionDie) {
        armorRoll = new Roll("@die", {die: damageReductionDie});
        armorRoll.evaluate();
        const p2 = game.dice3d.showForRoll(targetArmorRoll);  // show roll for DiceSoNice
        damage = Math.max(damage - armorRoll.total, 0);
        await Promise.allSettled([Promise.resolve(p1), Promise.resolve(p2)]);
      } else {
        await Promise.allSettled([Promise.resolve(p1)]);
      }
      takeDamage = `${game.i18n.localize('MB.Take')} ${damage} ${game.i18n.localize('MB.Damage')}`
    }

    const rollResult = {
      actor: this,
      armorRoll,
      damageRoll,      
      defendOutcome,
      defendRoll,
      items,
      takeDamage
    };
    await this._renderDefendRollCard(rollResult);
  }

  /**
   * Show attack rolls/result in a chat roll card.
   */
  async _renderDefendRollCard(rollResult) {
    const html = await renderTemplate(DEFEND_ROLL_CARD_TEMPLATE, rollResult)
    ChatMessage.create({
      content : html,
      sound : CONFIG.sounds.dice,
      speaker : ChatMessage.getSpeaker({actor: this}),
    });
  }

  /**
   * Check morale!
   */
  async checkMorale(sheetData) {
    const actorRollData = this.getRollData();
    const moraleRoll = new Roll("2d6", actorRollData);
    moraleRoll.evaluate();
    await game.dice3d.showForRoll(moraleRoll);  // show roll for DiceSoNice
    let outcomeRoll = null;
    if (moraleRoll.total > this.data.data.morale) {
      outcomeRoll = new Roll("1d6", actorRollData);
      outcomeRoll.evaluate();
      await game.dice3d.showForRoll(outcomeRoll);  // show roll for DiceSoNice
    }
    await this._renderMoraleRollCard(moraleRoll, outcomeRoll);
  }

  /**
   * Show morale roll/result in a chat roll card.
   */
  async _renderMoraleRollCard(moraleRoll, outcomeRoll) {
    let outcomeKey = null;
    if (outcomeRoll) {
      outcomeKey = outcomeRoll.total <= 3 ? "MB.MoraleFlees" : "MB.MoraleSurrenders";
    } else {
      outcomeKey = "MB.StandsFirm";
    }
    const outcomeText = game.i18n.localize(outcomeKey);
    const rollResult = {
      actor: this,
      outcomeRoll,
      outcomeText,
      moraleRoll,      
    };
    const html = await renderTemplate(MORALE_ROLL_CARD_TEMPLATE, rollResult)
    ChatMessage.create({
      content : html,
      sound : CONFIG.sounds.dice,
      speaker : ChatMessage.getSpeaker({actor: this}),
    });
  }

  /**
   * Check reaction!
   */
  async checkReaction(sheetData) {
    const actorRollData = this.getRollData();
    const reactionRoll = new Roll("2d6", actorRollData);
    reactionRoll.evaluate();
    await game.dice3d.showForRoll(reactionRoll);  // show roll for DiceSoNice
    await this._renderReactionRollCard(reactionRoll);
  }

  /**
   * Show reaction roll/result in a chat roll card.
   */
  async _renderReactionRollCard(reactionRoll) {
    let key = "";
    if (reactionRoll.total <= 3) {
      key = "MB.ReactionKill";
    } else if (reactionRoll.total <= 6) {
      key = "MB.ReactionAngered";
    } else if (reactionRoll.total <= 8) {
      key = "MB.ReactionIndifferent";
    } else if (reactionRoll.total <= 10) {
      key = "MB.ReactionAlmostFriendly";
    } else {
      key = "MB.ReactionHelpful";
    }
    let reactionText = game.i18n.localize(key);
    const rollResult = {
      actor: this,
      reactionRoll,
      reactionText,
    };
    const html = await renderTemplate(REACTION_ROLL_CARD_TEMPLATE, rollResult)
    ChatMessage.create({
      content : html,
      sound : CONFIG.sounds.dice,
      speaker : ChatMessage.getSpeaker({actor: this}),
    });
  }
}  

