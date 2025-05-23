import express           from "express"
import bodyParser        from "body-parser"
import { dirname }       from "path"
import path              from "path"
import { fileURLToPath } from "url"
import pg                from "pg"
import env               from "dotenv"
import bcrypt            from "bcrypt"
import GoogleStrategy    from "passport-google-oauth2"
import passport          from "passport"
import session           from "express-session"
import fetch             from "node-fetch"
// import { load }          from "cheerio"
import { Readability }   from "@mozilla/readability";
import { JSDOM }         from "jsdom";
// import { split }         from 'sentence-splitter'


const __dirname = dirname(fileURLToPath(import.meta.url));
const app       = express();
const port      = 3000;

env.config();

const db = new pg.Client({

    user: process.env.USER_NAME,
    host: process.env.HOST,
    password: process.env.USER_PASSWORD,
    port: process.env.PORT,
    database: process.env.DATABASE_NAME,

});

db.connect();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(passport.initialize());
app.use(passport.session());

app.get("/", (req, res) => {

    res.render(__dirname + "/frontend/login.ejs");

});

app.get("/login", (req, res) => {

    res.render(__dirname + "/frontend/login.ejs");

});

app.get("/register", (req, res) => {

    res.render(__dirname + "/frontend/register.ejs");

});

app.get("/forgot-password", (req, res) => {

    res.render(__dirname + "/frontend/forgotpassword.ejs");

});

app.get("/logged-in", (req, res) => {

    res.render(__dirname + "/frontend/index.ejs");

});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);

app.get(
  "/auth/google/logged-in",
  passport.authenticate("google", {
    successRedirect: "/logged-in",
    failureRedirect: "/login",
  })
);

// app.post(
//   "/login",
//   passport.authenticate("local", {
//     successRedirect: "/logged-in",
//     failureRedirect: "/login",
//   })
// );

app.post("/extract", async (req, res) => {

  const url = req.body.url;

  if (!url) {

    return res.status(400).send("No URL provided.");

  }

  try {

    const response = await fetch(url, {

      headers: { "User-Agent": "Mozilla/5.0" }

    });

    if (!response.ok) {

      throw new Error(`Failed to fetch: ${response.statusText}`);

    }

    const html = await response.text();

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent) {

      throw new Error("Could not extract meaningful content.");

    }

    const paragraphs = article.textContent
                        .split(/(?<=[.?!])\s+/)
                        .map(p => p.trim())
                        .filter(p => p.length > 30 && !p.toLowerCase().includes("copyright"));



    const jsonData = {

      url,
      title: article.title.trim(),
      content: paragraphs

    };

    req.session.jsonData = jsonData;

    res.render(path.join(__dirname, "frontend", "extract.ejs"), { jsonData });

  } catch (err) {
    
    console.error("Extraction error:", err);
    res.status(500).send("Failed to extract data from the URL.");

  }

});

app.get("/download-json", (req, res) => {

    const jsonData = req.session.jsonData;

    if (!jsonData) {

        return res.status(400).send("No data to download.");

    }
    res.setHeader('Content-disposition', 'attachment; filename=extracted.json');
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(jsonData, null, 2));

});

app.post("/login", async (req, res) => {

    try {

        const input_email = req.body.email;
        const input_password = req.body.password;

        const result = await db.query("SELECT * FROM users WHERE email = $1", [input_email]);

        try {

            if (result.rows.length === 0) {

                res.status(401).send("Check for username and password!");
                return;

            } else {

                const match = await checkPassword(input_password, result.rows[0].password);

                if (match) {

                    res.redirect("/logged-in");
                    return;

                } else {

                    res.status(401).send("Invalid password!");
                    return;

                }


            }

        } catch (error) {

            console.error("Error checking password:", error);
            res.status(500).send("Internal server error");
            return;

        }
    
    } catch (err) {

        console.error("Error executing query:", err);
        res.status(500).send("Internal server error");
        return;

    }

});

app.post("/register", async (req, res) => {

    try {

        const input_email = req.body.email;
        const input_password = req.body.password;
        const confirmed_password = req.body.confirm;

        const result = await db.query("SELECT * FROM users WHERE email = $1", [input_email]);

        if (result.rows.length !== 0) {

            res.status(401).send("Email already exists!");
            return;

        } else {

            if(input_password !== confirmed_password) {

                res.status(401).send("Password and confirmed password do not match!");
                return;

            } else {

                await db.query("INSERT INTO users (email, password) VALUES ($1, $2)", [input_email, await hashPassword(input_password)]);
                res.redirect("/login");

            }

        }


    } catch (err) {

        console.error("Error executing query:", err);
        res.status(500).send("Internal server error");
        return;

    }

});

app.post("/forgot-password", async(req, res) => {

    try {

        const input_email = req.body.email;
        const input_password = req.body.password;
        const confirmed_password = req.body.confirm;

        const result = await db.query("SELECT * FROM users WHERE email = $1", [input_email]);

        if (result.rows.length === 0) {

            res.status(401).send("Email does not exist!");
            return;

        } else {

            if(input_password !== confirmed_password) {

                res.status(401).send("Password and confirmed password do not match!");
                return;

            } else {

                await db.query("UPDATE users SET password = $1 WHERE email = $2", [await hashPassword(input_password), input_email]);
                res.redirect("/login");
                return;

            }

        }

    } catch (err) {

        console.error("Error executing query:", err);
        res.status(500).send("Internal server error");
        return;

    }

});

// passport.use(
//   "local",
//   new Strategy(async function verify(username, password, cb) {
//     try {
//       const result = await db.query("SELECT * FROM users WHERE email = $1 ", [
//         username,
//       ]);
//       if (result.rows.length > 0) {
//         const user = result.rows[0];
//         const storedHashedPassword = user.password;
//         bcrypt.compare(password, storedHashedPassword, (err, valid) => {
//           if (err) {
//             console.error("Error comparing passwords:", err);
//             return cb(err);
//           } else {
//             if (valid) {
//               return cb(null, user);
//             } else {
//               return cb(null, false);
//             }
//           }
//         });
//       } else {
//         return cb("User not found");
//       }
//     } catch (err) {
//       console.log(err);
//     }
//   })
// );

passport.use(
  "google",
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/logged-in",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        console.log(profile);
        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2)",
            [profile.email, "google"]
          );
          return cb(null, newUser.rows[0]);
        } else {
          return cb(null, result.rows[0]);
        }
      } catch (err) {
        return cb(err);
      }
    }
  )
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

async function hashPassword(password) {

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;

};

async function checkPassword(input_password, hashedPassword) {

    return await bcrypt.compare(input_password, hashedPassword);

};

app.listen(port, () => {

    console.log(`Server is running on port: ${port}`)

});