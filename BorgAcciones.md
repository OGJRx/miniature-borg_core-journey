# Manual DevOps Actions for TITANIUM Refactoring

Follow these steps to provision and deploy the new D1 database.

1.  **Create the D1 Database:**
    Open your terminal and run the following command. This will create a new D1 database named `borgptron-db` and output its `database_id`.

    ```bash
    npx wrangler d1 create borgptron-db
    ```

2.  **Update `wrangler.toml`:**
    Copy the `database_id` from the output of the previous command and paste it into the `wrangler.toml` file, replacing the placeholder.

    *   **File:** `wrangler.toml`
    *   **Field:** `database_id`
    *   **Replace:** `"REPLACE_WITH_REAL_ID_FROM_BORGACCIONES"` -> `"your-new-database-id"`

3.  **Apply the Database Schema:**
    Run this command to create the `users` and `jobs` tables in your new database.

    ```bash
    npx wrangler d1 execute borgptron-db --file=schema.sql
    ```

4.  **Deploy the Worker:**
    Finally, deploy the refactored worker to Cloudflare.

    ```bash
    npx wrangler deploy
    ```
