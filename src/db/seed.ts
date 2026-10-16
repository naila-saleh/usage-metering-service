import {createPlan, getPlanByName} from './queries/plans';
import {createSubplan, getSubplanByName} from './queries/subplans';
import {closeDb} from './index';

const seed = async () => {
    try {
        // Create a plan
        let accountPlan = await getPlanByName("Account Plans");
        if (!accountPlan) {
            accountPlan = await createPlan({
                name: "Account Plans",
                description: "This is a plan for managing accounts plans.",
            });
        }
        let userPlan = await getPlanByName("User Plans");
        if (!userPlan) {
            userPlan = await createPlan({
                name: "User Plans",
                description: "This is a plan for managing users plans.",
            });
        }

        // Create a subplan for the plan
        if(!(await getSubplanByName(accountPlan!.id, "Pro"))) {
            await createSubplan({
                plan_id: accountPlan!.id,
                name: "Pro",
                description: "This is a Pro plan for Accounts.",
                price: "49.99",
                monthly_limit: 1000,
                max_request_limit: 100,
                is_system_plan: true,
            });
        }
        if(!(await getSubplanByName(accountPlan!.id, "Starter"))) {
            await createSubplan({
                plan_id: accountPlan!.id,
                name: "Starter",
                description: "This is a Starter plan for Accounts.",
                price: "19.99",
                monthly_limit: 100,
                max_request_limit: 10,
                is_system_plan: true,
            });
        }
        if(!(await getSubplanByName(userPlan!.id, "Premium"))) {
            await createSubplan({
                plan_id: userPlan!.id,
                name: "Premium",
                description: "This is a Premium plan for Users.",
                price: "99.99",
                monthly_limit: 10000,
                max_request_limit: 1000,
                is_system_plan: true,
            });
        }
        if(!(await getSubplanByName(userPlan!.id, "Basic"))) {
            await createSubplan({
                plan_id: userPlan!.id,
                name: "Basic",
                description: "This is a Basic plan for Users.",
                price: "9.99",
                monthly_limit: 100,
                max_request_limit: 10,
                is_system_plan: true,
            });
        }
        console.log("Seeding completed successfully.");
    } catch (error) {
        console.error("Error seeding the database:", error);
        throw error;
    } finally {
        await closeDb();
    }
}

async function main() {
    try {
        await seed();
    } catch (error) {
        process.exitCode = 1;
    }
}

main();