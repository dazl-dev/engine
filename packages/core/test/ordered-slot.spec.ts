import { expect } from 'chai';
import { OrderedRegistry } from '@dazl/engine-core';

describe('ordered-slot', () => {
    const MENU_FILE = 'File';
    const MENU_EDIT = 'Edit';
    const MENU_HELP = 'Help';

    const testItems = [
        {
            name: MENU_FILE,
            age: 1,
        },
        {
            name: MENU_FILE,
            age: 2,
        },
        {
            name: MENU_EDIT,
            age: 1,
        },
        {
            name: MENU_EDIT,
            age: 2,
        },
        {
            name: MENU_HELP,
            age: 1,
        },
        {
            name: MENU_HELP,
            age: 2,
        },
    ];

    const slotToString = (slot: OrderedRegistry<{ name: string; age: number }>) =>
        [...slot].map((item) => `${item.name}:${item.age}`).join(', ');

    it('should not sort items without specifying order', () => {
        const slot = new OrderedRegistry<{ name: string; age: number }>();
        slot.setItems(testItems);

        expect(slotToString(slot)).to.eql(
            `${MENU_FILE}:1, ${MENU_FILE}:2, ${MENU_EDIT}:1, ${MENU_EDIT}:2, ${MENU_HELP}:1, ${MENU_HELP}:2`,
        );
    });

    it('should sort items according to order passed to constructor', () => {
        const slot = new OrderedRegistry<{ name: string; age: number }>().setItems(testItems).setSortingOrder([
            ['name', [MENU_HELP, MENU_FILE, MENU_EDIT]],
            ['age', [1, 2]],
        ]);
        expect(slotToString(slot)).to.eql(
            `${MENU_HELP}:1, ${MENU_HELP}:2, ${MENU_FILE}:1, ${MENU_FILE}:2, ${MENU_EDIT}:1, ${MENU_EDIT}:2`,
        );

        slot.setSortingOrder([
            ['age', [1, 2]],
            ['name', [MENU_HELP, MENU_FILE, MENU_EDIT]],
        ]);
        expect(slotToString(slot)).to.eql(
            `${MENU_HELP}:1, ${MENU_FILE}:1, ${MENU_EDIT}:1, ${MENU_HELP}:2, ${MENU_FILE}:2, ${MENU_EDIT}:2`,
        );

        slot.setSortingOrder([
            ['age', false],
            ['name', [MENU_HELP, MENU_FILE, MENU_EDIT]],
        ]);
        expect(slotToString(slot)).to.eql(
            `${MENU_HELP}:1, ${MENU_FILE}:1, ${MENU_EDIT}:1, ${MENU_HELP}:2, ${MENU_FILE}:2, ${MENU_EDIT}:2`,
        );

        slot.setSortingOrder([
            ['age', true],
            ['name', [MENU_HELP, MENU_FILE, MENU_EDIT]],
        ]);
        expect(slotToString(slot)).to.eql(
            `${MENU_HELP}:2, ${MENU_FILE}:2, ${MENU_EDIT}:2, ${MENU_HELP}:1, ${MENU_FILE}:1, ${MENU_EDIT}:1`,
        );
    });

    it('should sort items according to order that was set after items were registered', () => {
        const slot = new OrderedRegistry<{ name: string; age: number }>().setItems(testItems);

        slot.setSortingOrder([
            ['name', [MENU_HELP, MENU_FILE, MENU_EDIT]],
            ['age', [1, 2]],
        ]);

        expect(slotToString(slot)).to.eql(
            `${MENU_HELP}:1, ${MENU_HELP}:2, ${MENU_FILE}:1, ${MENU_FILE}:2, ${MENU_EDIT}:1, ${MENU_EDIT}:2`,
        );
    });

    it('should sort items after add according to sort order', () => {
        const slot = new OrderedRegistry<{ name: string; age: number }>();

        slot.setSortingOrder([
            ['name', [MENU_HELP, MENU_FILE, MENU_EDIT]],
            ['age', [1, 2]],
        ]);

        testItems.forEach((item) => {
            slot.register(item);
        });

        expect(slotToString(slot)).to.eql(
            `${MENU_HELP}:1, ${MENU_HELP}:2, ${MENU_FILE}:1, ${MENU_FILE}:2, ${MENU_EDIT}:1, ${MENU_EDIT}:2`,
        );
    });

    it('should move unknown items to the end', () => {
        const slot = new OrderedRegistry<{ name: string; age: number }>();

        slot.setSortingOrder([
            ['name', [MENU_HELP, MENU_FILE, MENU_EDIT]],
            ['age', [1, 2]],
        ]);

        slot.register({ name: 'More', age: 1 });

        testItems.forEach((item) => {
            slot.register(item);
        });

        expect(slotToString(slot)).to.eql(
            `${MENU_HELP}:1, ${MENU_HELP}:2, ${MENU_FILE}:1, ${MENU_FILE}:2, ${MENU_EDIT}:1, ${MENU_EDIT}:2, More:1`,
        );
    });
});
