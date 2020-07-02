import { getRepository, getCustomRepository, In } from "typeorm";
import Transaction from "../models/Transaction";
import Category from "../models/Category";
import csvParse from "csv-parse";
import fs from "fs";

import TransactionsRepository from "../repositories/TransactionsRepository";

interface CSVTransaction {
  title: string;
  type: "income" | "outcome";
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const transactionsRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    const contactsReadStream = fs.createReadStream(filePath);

    const parsers = csvParse({
      from_line: 2, // excludes the headers from the csv
    });

    // this will read each line from the CSV
    const parseCSV = contactsReadStream.pipe(parsers);

    const transactions: CSVTransaction[] = [];

    const categories: string[] = [];

    parseCSV.on("data", async (line) => {
      const [title, type, value, category] = line.map((cell: string) => cell.trim());

      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, type, value, category });
    });

    // if the parseCSV.on() returns end, then it finishes/closes the promise
    // we need this to be able to read the CSV completely
    await new Promise((resolve) => parseCSV.on("end", resolve));

    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories),
      },
    });

    // we do this to filter out ID's, created_at and updated_at from the categories, as we are only interested in the title
    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title
    );

    // scans the array with all categories from the csv and only keep the ones that are not inside existentCategoriesTitles
    const addCategoryTitles = categories
      .filter((category) => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);

    const newCategories = categoriesRepository.create(
      addCategoryTitles.map((title) => ({
        title,
      }))
    );

    await categoriesRepository.save(newCategories);

    const finalCategories = [...newCategories, ...existentCategories];

    // maps the array of transactions into a object with title, type, value and category
    // for category we look into the list with all categories and we match the title
    const createdTransactions = transactionsRepository.create(
      transactions.map((transaction) => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: finalCategories.find(
          (category) => category.title === transaction.category
        ),
      }))
    );

    await transactionsRepository.save(createdTransactions);

    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
