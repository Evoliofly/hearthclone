const Battlefield = require('./battlefield')
const Hand = require('./hand')
const Library = require('./library')
const Graveyard = require('./graveyard')
const Secrets = require('./secrets')

const Classes = require('./../enums/classes')
const Cards = require('./../enums/cards')
const CardTypes = require('./../enums/cardTypes')

class Player {

	constructor(game, client, deck = Array(30).fill(Cards.TOKEN), playerClass = Classes.MAGE, startingHealth = 30, totalMana = 0){

		this.game = game
		this.client = client
		this.class = playerClass

		// Mage base deck
		deck = [
			Cards.ARCANE_MISSILES,
			Cards.ARCANE_MISSILES,
			Cards.FROSTBOLT,
			Cards.FROSTBOLT,
			Cards.ARCANE_INTELLECT,
			Cards.ARCANE_INTELLECT,
			Cards.FIREBALL,
			Cards.FIREBALL,
			Cards.POLYMORPH,
			Cards.POLYMORPH,
			Cards.WATER_ELEMENTAL,
			Cards.WATER_ELEMENTAL,
			Cards.FLAMESTRIKE,
			Cards.FLAMESTRIKE,
			Cards.ACIDIC_SWAMP_OOZE,
			Cards.ACIDIC_SWAMP_OOZE,
			Cards.BLOODFEN_RAPTOR,
			Cards.BLOODFEN_RAPTOR,
			Cards.IRONFUR_GRIZZLY,
			Cards.IRONFUR_GRIZZLY,
			Cards.SHATTERED_SUN_CLERIC,
			Cards.SHATTERED_SUN_CLERIC,
			Cards.CHILLWIND_YETI,
			Cards.CHILLWIND_YETI,
			Cards.GNOMISH_INVENTOR,
			Cards.GNOMISH_INVENTOR,
			Cards.SENJIN_SHIELDMASTA,
			Cards.SENJIN_SHIELDMASTA,
			Cards.BOULDERFIST_OGRE,
			Cards.BOULDERFIST_OGRE
		]
		this.deck = deck

		this.battlefield = new Battlefield(this)
		this.hand = new Hand(this)
		this.library = new Library(this, this.deck)
		this.graveyard = new Graveyard(this)
		this.secrets = new Secrets(this)

		this.startingHealth = startingHealth
		this.health = startingHealth
		this.shield = 0
		this.immune = false
		this.frozen = false

		this.totalMana = totalMana
		this.availableMana = totalMana
		this.overload = 0

		this.weapon = null
		this.weaponAlreadyUsed = false
		this.heroPower = Cards.copy(Cards.FIREBLAST)
		this.heroPowerAlreadyUsed = false
		this.attacked = false

		this.isHisTurn = false
		this.hand.drawCards(3)
	}

	/* getters */

	get id(){
		return this.client.socket.id
	}

	get opponent(){
		return this.game.opponentOf(this)
	}

	get spellPower(){
		return this.battlefield.calculateSpellPower()
	}

	/* to client */

	notify(action, data){
		data.action = action
		this.client.socket.emit('notification', data)
	}

	/* hooks */

	newTurn(){
		this.game.eventEmitter.emit('newTurn', {player: this})

		this.hand.drawCard()
		this.weaponAlreadyUsed = this.heroPowerAlreadyUsed = this.attacked = false
		this.totalMana = Math.min(this.totalMana+1, 10)
		this.availableMana = this.totalMana - this.overload
		this.overload = 0
		this.immune = this.attacked = false
		this.battlefield.minions.forEach(minion => minion.reset())

		this.isHisTurn = true
		this.automaticEndOfTurn = setTimeout(_ => this.endTurn(), 75000)
	}

	endTurn(){

		// Unfreeze if did not attack

		this.battlefield.minions.forEach(minion => {
			if (!minion.attacked)
				minion.card.frozen = false
		})

		if (!this.attacked)
			this.frozen = false

		clearTimeout(this.automaticEndOfTurn)
		this.isHisTurn = false
		this.game.eventEmitter.emit('endOfTurn', {player: this})
		if (this.health > 0 && this.opponent.health > 0)
			this.opponent.newTurn()

	}

	/* Play action */

	play(data){
		if (!this.isHisTurn)
			throw new Error('Not your turn.')
		if (typeof data.action === 'undefined')
			throw new Error('No action specified.')
		// The player that used the card is referenced by data.player in spells, battlecry...
		data.player = this
		switch (data.action){
			case 'endTurn':
				this.endTurn()
				break
			case 'playCard':
				this.playCardByIndex(data.index, data)
				break
			case 'useHeroPower':
				this.useHeroPower(data)
				this.heroPowerAlreadyUsed = true
				break
			case 'useWeapon':
				this.useWeapon(data)
				break
			case 'attackWithMinion':
				if (data.on !== 'hero' && data.on !== 'minion')
					throw new Error('On should be either "hero" or "minion".')
				let target = null
				if (data.on === 'hero')
					target = this.opponent
				else 
					target = this.opponent.battlefield.getMinionByIndex(data.index)
				this.battlefield.getMinionByIndex(data.with).attack(target)
				break
			default:
				throw new Error('Unknow action.')
		}
	}

	playCardByIndex(index, data = {}){
		return this.hand.playCardByIndex(index, data)
	}

	useHeroPower(data){
		if (this.heroPowerAlreadyUsed)
			throw new Error('Hero power already used.')
		return this.playCard(this.heroPower, data)
	}

	useWeapon(data){
		if (this.weapon === null)
			throw new Error('No weapon equiped.')
		if (this.weaponAlreadyUsed)
			throw new Error('Weapon already used.')
		if (this.frozen)
			throw new Error('Can\'t attack when frozen.')
		if (data.on !== 'hero' || data.on !== 'minion')
			throw new Error('On should be either "hero" or "minion".')
		let target = null
		if (data.on === 'hero')
			target = this.opponent
		else 
			target = this.opponent.battlefield.getMinionByIndex(data.index)
		if (!target.canBeAttacked)
			throw new Error('The target can\'t be attacked.')
		this.weaponAlreadyUsed = true
		this.weapon.durability--
		let interrupted = this.game.eventEmitter.emit('willAttack', {target: target, attacker: this, player: this})
		if (interrupted)
			return
		target.dealDamages(this.weapon.attack)
		this.game.eventEmitter.emit('attacked', {target: target, attacker: this, player: this})

		if (!this.weapon.durability){
			this.graveyard.add(this.weapon)
			this.game.eventEmitter.emit('weaponWasDestroyed', {weapon: this.weapon, player: this})
			this.gave.eventEmitter.removeInterruptorByCard(this.weapon)
			this.weapon = null
		}
	}

	playCard(card, data = {}){
		if (this.availableMana - card.cost < 0)
			throw new Error('Not enough mana.')

		// If the card is a "Choose One", we should have an index.
		if (card.chooseOne)
			if (typeof card.chooseOne[data.chooseOne] === 'undefined')
				throw new Error('The played card expects a choose one')
			else
				card = Cards.find(c => id === card.chooseOne[data.chooseOne])
			
		// TODO: Target could be a function and you check with card.target(target)
		// Target translation from {enemy: true/false, hero: true/false, index: n} to Object
		// If the card is a minion and no target was specified, it's ok if you didn't have choice.
		if (card.target){

			if (card.type == CardTypes.MINION && !data.target && ((
				card.target == 'minion' &&
				!this.battlefield.minions.length && !this.opponent.battlefield.minions.length 
				) || (
				card.target == 'friendlyMinion' &&
				!this.battlefield.minions.length
				) || (
				card.target == 'enemyMinion' &&
				!this.opponent.battlefield.minions.length
				))){
				data.target = null
			} else {
				if (!data.target || typeof data.target.enemy === 'undefined' || typeof data.target.hero === 'undefined' || (!data.target.hero && typeof data.target.index === 'undefined'))
					throw new Error('The played card expects a target.')
				// Type of
				if ((card.target === 'hero' || card.target === 'enemyHero' || card.target === 'friendlyHero') && data.target.hero === false)
					throw new Error('The played card expects a hero target.')
				if ((card.target === 'minion' || card.target === 'enemyMinion' || card.target === 'friendlyMinion') && data.target.hero === true)
					throw new Error('The played card expects a minion target.')
				// Enemy of
				if ((card.target === 'enemyHero' || card.target === 'enemyMinion') && data.target.enemy === false)
					throw new Error('The played card expects an enemy target.')
				if ((card.target === 'friendlyMinion' || card.target === 'friendlyHero') && data.target.enemy === true)
					throw new Error('The played card expects an friendly target.')
				if (data.target.hero)
					data.target = data.target.enemy ? this.opponent : this
				else {
					const battlefield = data.target.enemy ? this.opponent.battlefield : this.battlefield
					data.target = battlefield.getMinionByIndex(data.target.index)
				}
				if (data.target.card && data.target.card.stealth)
					throw new Error('Target invalid cause stealth.')
			}
		}

		card.player = this

		if (card.cardType === CardTypes.MINION)
			this.playMinion(card, data)

		else if (card.cardType === CardTypes.SPELL)
			this.playSpell(card, data)

		else if (card.cardType === CardTypes.ENCHANTMENT)
			this.playEnchantment(card, data)

		else if (card.cardType === CardTypes.WEAPON)
			this.playWeapon(card)

		else if (card.cardType === CardTypes.HERO_POWER)
			this.playHeroPower(card, data)

		this.availableMana -= card.cost
		this.game.eventEmitter.emit('played', {player: this, card: card})
	}

	// Todo: add position
	playMinion(minion, data = {}){
		if (this.battlefield.minions.length>=7)
			throw new Error('Battlefield full.')
		let interrupted = this.game.eventEmitter.emit('willPlay', {player: this, card: minion})
		if (interrupted)
			return
		this.battlefield.newMinion(this, minion, data, true)
	}

	playSpell(spell, data = {}){
		if (spell.interruptor){
			if (!this.secrets.canBePlayed(spell))
				throw new Error('This secret can\'t be played: already in game.')
			this.game.eventEmitter.emit('plays', {player: this, card: spell})
			this.secrets.add(spell)
			return
		}

		let interrupted = this.game.eventEmitter.emit('willPlay', {player: this, card: spell})
		if (interrupted)
			return
		spell.effect(data)
		this.graveyard.add(spell)
	}

	playEnchantment(enchantment, data = {}){
		if (!data.target)
			throw new Exception('Missing target.')
		let interrupted = this.game.eventEmitter.emit('willPlay', {player: this, card: enchantment})
		if (interrupted)
			return
		data.target.enchant(enchantment)
	}

	playWeapon(weapon, data = {}){
		let interrupted = this.game.eventEmitter.emit('willPlay', {player: this, card: weapon})
		if (interrupted)
			return
		if (weapon.interruptor){
			weapon.interruptor.card = weapon
			this.game.eventEmitter.addInterruptor(weapon.interruptor)
		}
		this.weapon = weapon
	}

	playHeroPower(heroPower, data = {}){
		let interrupted = this.game.eventEmitter.emit('willPlay', {player: this, card: heroPower})
		if (interrupted)
			return
		heroPower.effect(data)
	}

	/* Character */

		canBeAttacked(){
		return !this.immune && !this.battlefield.minions.some(minion => minion.card.taunt)
	}

	dealDamages(damages){
		if (this.immune)
			throw new Error('Target is immune')
		let interrupted = this.game.eventEmitter.emit('willBeDealtDamages', {target: this, damages: damages})
		if (interrupted)
			return
		this.shield -= damages
		if (this.shield > 0)
			return
		damages = -this.shield
		this.shield = 0
		this.health -= damages
		interrupted = this.game.eventEmitter.emit('wasDealtDamages', {target: this, damages: damages})
		if (interrupted)
			return
		if (this.health > 0)
			return
		this.game.won(this.opponent)
	}

	heal(hp){
		let interrupted = this.game.eventEmitter.emit('willBeHealed', {target: this})
		if (interrupted)
			return
		const oldHealth = this.health
		this.health = min(this.startingHealth, this.health+hp)
		if (this.health - this.oldHealth)
			this.game.eventEmitter.emit('wasHealed', {target: this, hp: this.health - this.oldHealth})
	}

	freeze(){
		let interrupted = this.player.game.eventEmitter.emit('willBeFrozen', {target: this})
		if (interrupted)
			return
		this.frozen = true
		this.player.game.eventEmitter.emit('wasFrozen', {target: this})
	}

	/* logs */

	status(){
		return `// ${this.id} - ${this.health}/${this.startingHealth} (+${this.shield} Shield) //\n`+
		`// His turn? ${this.isHisTurn} //\n`+
		`// Mana: ${this.availableMana}/${this.totalMana} (${this.overload} Overload) //\n`+
		`// Weapon: ${this.weapon === null ? '/' : (this.weapon.cardName + ' ' +this.weapon.attack+'/'+this.weapon.durability+' Already Used '+this.weaponAlreadyUsed)} //\n`+
		`// immune: ${this.immune} //\n`+
		`////////////// SECRETS ///////////////\n`+
		this.secrets.status()+'\n'+
		`// Library: ${this.library.cards.length}\n`+
		`// Graveyard: ${this.graveyard.cards.length}\n`+
		`/////////////// HAND //////////////////////\n`+
		this.hand.status()+'\n'+
		`/////////////// BATTLEFIELD ///////////////////////\n`+
		this.battlefield.status()+'\n'
	}

}

module.exports = Player