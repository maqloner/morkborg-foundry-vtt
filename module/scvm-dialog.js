import { classItemFromPack, createScvm, findClassPacks, scvmifyActor } from "./scvmfactory.js";

export default class ScvmDialog extends Application {

    constructor(actor=null, options={}) {
        super(options);
        this.actor = actor;
        const classPacks = findClassPacks();
        this.classes = classPacks.map(p => {
            return {
                name: p.split("class-")[1].replaceAll("-", " "),
                pack: p
            }});
        this.classes.sort((a, b) => (a.name > b.name) ? 1 : -1);
    }

    /** @override */
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.id = "scvm-dialog";
        options.classes = ["morkborg"];
        options.title = "The Scvmfactory";
        options.template = "systems/morkborg/templates/scvm-dialog.html";
        options.width = 420;
        options.height = "auto";
        return options;
    }

    /** @override */
    getData(options={}) {
        return mergeObject(super.getData(options), {
            classes: this.classes,
            forActor: this.actor !== undefined,
        });
    }

    /** @override */
    activateListeners(html) {
        super.activateListeners(html);
        html.find('.toggle-all').click(this._onToggleAll.bind(this));
        html.find('.toggle-none').click(this._onToggleNone.bind(this));
        html.find('.cancel-button').click(this._onCancel.bind(this));
        html.find('.scvm-button').click(this._onScvm.bind(this));
    }

    _onToggleAll(event) {
        event.preventDefault();
        const form = $(event.currentTarget).parents(".scvm-dialog")[0];
        $(form).find(".class-checkbox").prop('checked', true);
    }

    _onToggleNone(event) {
        event.preventDefault();
        const form = $(event.currentTarget).parents(".scvm-dialog")[0];
        $(form).find(".class-checkbox").prop('checked', false);
    }

    _onCancel(event) {
        event.preventDefault();
        this.close();
    }

    async _onScvm(event) {
        event.preventDefault();
        const form = $(event.currentTarget).parents(".scvm-dialog")[0];
        const selected = [];
        $(form).find("input:checked").each(function() {
           selected.push($(this).attr("name"));
        });

        if (selected.length === 0) {
            // nothing selected, so bail
            return;
        }

        const packName = selected[Math.floor(Math.random() * selected.length)];
        const clazz = await classItemFromPack(packName);
        if (!clazz) {
            // couldn't find class item, so bail
            const err = `No class item found in compendium ${packName}`;
            console.error(err);
            ui.notifications.error(err);
            return;
        }

        try {
            if (this.actor) {
                await scvmifyActor(this.actor, clazz);
            } else {
                await createScvm(clazz);
            }    
        } catch (err) {
            console.error(err);
            ui.notifications.error(`Error creating ${clazz.name}. Check console for error log.`);
        }

        this.close();
    }    
}  